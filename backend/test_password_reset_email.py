import ast
import inspect
import logging
import os
import runpy
import smtplib
import socket
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from flask import Flask

from models import Resident, ResidentAccount, User
from routes import users
from services import mailer
from services.password_setup import (
    create_password_setup_token,
    is_token_password_current,
    read_password_setup_token,
)


class PasswordResetEmailTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True,
            JWT_SECRET_KEY='test-only-signing-key',
            MAIL_MAILER='smtp',
            MAIL_HOST='smtp.example.com',
            MAIL_PORT=587,
            MAIL_USERNAME='sender@example.com',
            MAIL_PASSWORD='test-only-secret',
            MAIL_ENCRYPTION='tls',
            FRONTEND_URL_PUBLIC='https://public.example.com/',
            FRONTEND_URL='http://localhost:5173/',
        )
        self.user = User(
            id=6, name='Test User', email='recipient@example.com',
            role='admin', password_hash='test-password-fingerprint', resident_id=None,
        )
        self.app.add_url_rule(
            '/reset', methods=['POST'],
            view_func=lambda: inspect.unwrap(users.reset_user_password)(6),
        )

    def test_mail_failures_return_distinct_502_messages_without_passwords(self):
        cases = [
            (smtplib.SMTPAuthenticationError(535, b'test-only-secret rejected'), users.SMTP_LOGIN_ERROR),
            (smtplib.SMTPServerDisconnected('Connection unexpectedly closed'), users.SMTP_DISCONNECTED_ERROR),
            (TimeoutError('timed out'), users.SMTP_CONNECTION_ERROR),
            (ConnectionRefusedError('refused'), users.SMTP_CONNECTION_ERROR),
            (socket.gaierror('name resolution failed'), users.SMTP_CONNECTION_ERROR),
            (smtplib.SMTPConnectError(421, b'unavailable'), users.SMTP_CONNECTION_ERROR),
            (smtplib.SMTPRecipientsRefused({'recipient@example.com': (550, b'rejected')}),
             'The recipient address was rejected.'),
            (mailer.MailConfigurationError('missing settings'),
             'Email is not configured correctly. Check the backend MAIL_* settings and frontend URLs.'),
            (RuntimeError('unexpected test-only-secret'),
             'Could not send the email. Check the backend logs for details.'),
        ]
        for error, expected in cases:
            with self.subTest(error=type(error).__name__), \
                    patch.object(users, 'User') as model, \
                    patch.object(users, 'create_password_setup_token', return_value='test-token'), \
                    patch.object(users, 'send_password_setup_email', side_effect=error), \
                    patch.object(users.db, 'session') as session, \
                    self.assertLogs(level=logging.ERROR) as logs:
                model.query.get_or_404.return_value = self.user
                response = self.app.test_client().post('/reset')
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.json['error'], expected)
                self.assertIn(type(error).__name__, '\n'.join(logs.output))
                self.assertNotIn('test-only-secret', '\n'.join(logs.output))
                self.assertNotIn('test-only-secret', response.get_data(as_text=True))
                session.commit.assert_not_called()

    def test_success_preserves_token_send_and_activity_log(self):
        with patch.object(users, 'User') as model, \
                patch.object(users, 'create_password_setup_token', return_value='test-token'), \
                patch.object(users, 'send_password_setup_email') as send, \
                patch.object(users, 'get_jwt_identity', return_value='1'), \
                patch.object(users, 'SystemLog') as log, \
                patch.object(users.db, 'session') as session:
            model.query.get_or_404.return_value = self.user
            response = self.app.test_client().post('/reset')
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json['email_sent'])
            send.assert_called_once_with(self.user, 'test-token', purpose='reset')
            log.assert_called_once()
            session.commit.assert_called_once()

    def test_staff_reset_builds_email_and_token_for_the_users_table(self):
        # Staff User also has resident_id; its presence must not select ResidentAccount.
        for role, resident_id in [('admin', None), ('lgu_personnel', None), ('admin', 12)]:
            with self.subTest(role=role, resident_id=resident_id), \
                    patch.object(users, 'User') as model, \
                    patch.object(mailer, '_send_smtp_message') as send, \
                    patch.object(users, 'get_jwt_identity', return_value='1'), \
                    patch.object(users, 'SystemLog'), \
                    patch.object(users.db, 'session'):
                self.user.role = role
                self.user.resident_id = resident_id
                model.query.get_or_404.return_value = self.user
                response = self.app.test_client().post('/reset')
                self.assertEqual(response.status_code, 200)
                message = send.call_args.args[0]
                body = message.get_body(preferencelist=('plain',)).get_content()
                self.assertIn('Hello Test User,', body)
                link = next(line for line in body.splitlines() if line.startswith('https://'))
                token = parse_qs(urlparse(link).query)['token'][0]
                with self.app.app_context():
                    payload, error = read_password_setup_token(token)
                self.assertIsNone(error)
                self.assertEqual(payload['account_type'], 'user')
                self.assertEqual(payload['user_id'], self.user.id)
                self.assertTrue(is_token_password_current(payload, self.user.password_hash))
                self.assertFalse(is_token_password_current(payload, 'changed-password-fingerprint'))

    def test_resident_account_keeps_resident_greeting_and_token_type(self):
        account = ResidentAccount(
            id=6, resident_id=12, email='resident@example.com',
            password_hash='resident-password-fingerprint',
            resident=Resident(first_name='Test', last_name='Resident'),
        )
        with self.app.app_context(), patch.object(mailer, '_send_smtp_message') as send:
            token = create_password_setup_token(account)
            payload, error = read_password_setup_token(token)
            self.assertIsNone(error)
            self.assertEqual(payload['account_type'], 'resident_account')
            self.assertEqual(payload['user_id'], account.id)
            mailer.send_password_setup_email(account, token, purpose='reset')
            message = send.call_args.args[0]
            self.assertIn('Hello Test Resident,', message.get_body(preferencelist=('plain',)).get_content())
            self.assertEqual(message['To'], account.email)

    def test_reset_email_links_and_empty_url_handling(self):
        for public, local in [('https://public.example.com', 'http://localhost:5173'),
                              ('', 'http://localhost:5173'),
                              ('https://public.example.com', '')]:
            with self.subTest(public=public, local=local), self.app.app_context(), \
                    patch.object(mailer, '_send_smtp_message') as send:
                self.app.config.update(FRONTEND_URL_PUBLIC=public, FRONTEND_URL=local)
                mailer.send_password_setup_email(self.user, 'test-token', purpose='reset')
                message = send.call_args.args[0]
                for content_type in ('plain', 'html'):
                    body = message.get_body(preferencelist=(content_type,)).get_content()
                    for url in (public, local):
                        if url:
                            self.assertIn(f'{url}/set-password?token=test-token', body)
                    self.assertNotIn('test-only-secret', body)
                    self.assertEqual('Only if the public server is unavailable' in body, bool(public and local))
                    if public and local:
                        self.assertLess(body.index(public), body.index(local))
        with self.app.app_context(), patch.object(mailer, '_send_smtp_message') as send:
            self.app.config.update(
                FRONTEND_URL_PUBLIC='https://evacway.vercel.app/',
                FRONTEND_URL='https://evacway.vercel.app',
            )
            mailer.send_password_setup_email(self.user, 'test-token', purpose='reset')
            message = send.call_args.args[0]
            for content_type in ('plain', 'html'):
                body = message.get_body(preferencelist=(content_type,)).get_content()
                self.assertIn('https://evacway.vercel.app/set-password?token=test-token', body)
                self.assertNotIn('Only if the public server is unavailable', body)
        with self.app.app_context(), patch.object(mailer, '_send_smtp_message') as send:
            self.app.config.update(FRONTEND_URL_PUBLIC='', FRONTEND_URL='')
            with self.assertRaises(mailer.MailConfigurationError):
                mailer.send_password_setup_email(self.user, 'test-token', purpose='reset')
            send.assert_not_called()

    def test_tls_and_ssl_transport(self):
        for encryption, port in [('tls', 587), ('ssl', 465)]:
            with self.subTest(encryption=encryption), self.app.app_context(), \
                    patch.object(mailer.smtplib, 'SMTP') as smtp, \
                    patch.object(mailer.smtplib, 'SMTP_SSL') as smtp_ssl:
                self.app.config.update(MAIL_ENCRYPTION=encryption, MAIL_PORT=port)
                mailer._send_smtp_message('test message')
                transport, unused = (smtp, smtp_ssl) if encryption == 'tls' else (smtp_ssl, smtp)
                self.assertEqual(transport.call_args.args, ('smtp.example.com', port))
                self.assertGreaterEqual(transport.call_args.kwargs['timeout'], 15)
                server = transport.return_value.__enter__.return_value
                server.login.assert_called_once_with('sender@example.com', 'test-only-secret')
                server.send_message.assert_called_once_with('test message')
                unused.assert_not_called()
                if encryption == 'tls':
                    server.starttls.assert_called_once()
                    self.assertLess(
                        [c[0] for c in server.method_calls].index('starttls'),
                        [c[0] for c in server.method_calls].index('login'),
                    )

    def test_mail_names_take_priority_over_stale_smtp_aliases(self):
        with patch.dict(os.environ, {
            'MAIL_HOST': 'smtp.example.com', 'SMTP_HOST': 'stale.example.com',
            'MAIL_PORT': '587', 'SMTP_PORT': '465',
            'MAIL_USERNAME': 'sender@example.com', 'SMTP_USER': 'stale@example.com',
            'MAIL_PASSWORD': ' "abcd efgh ijkl mnop" ', 'SMTP_PASSWORD': 'stale-secret',
        }, clear=True), patch('dotenv.load_dotenv'):
            config = runpy.run_path(str(Path(__file__).with_name('config.py')))['Config']
            self.assertEqual(config.MAIL_HOST, 'smtp.example.com')
            self.assertEqual(config.MAIL_PORT, 587)
            self.assertEqual(config.MAIL_USERNAME, 'sender@example.com')
            self.assertEqual(config.MAIL_PASSWORD, 'abcdefghijklmnop')

    def test_startup_warning_lists_missing_names_without_values(self):
        tree = ast.parse(Path(__file__).with_name('app.py').read_text(encoding='utf-8'))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == '_warn_if_smtp_config_missing')
        namespace = {'app': self.app, 'os': os}
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'app.py', 'exec'), namespace)
        self.app.config.update(MAIL_HOST='', MAIL_USERNAME='', MAIL_PASSWORD='')
        with patch.dict(os.environ, {'MAIL_PORT': ''}), self.assertLogs(level=logging.WARNING) as logs:
            namespace['_warn_if_smtp_config_missing']()
        for name in ('MAIL_HOST', 'MAIL_PORT', 'MAIL_USERNAME', 'MAIL_PASSWORD'):
            self.assertIn(name, '\n'.join(logs.output))
        self.assertNotIn('test-only-secret', '\n'.join(logs.output))


if __name__ == '__main__':
    unittest.main()
