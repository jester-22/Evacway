import io
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from flask import Flask
from werkzeug.datastructures import FileStorage

from models import UploadedFile, db
from services.upload_storage import (
    delete_uploaded_photo,
    get_uploaded_file_from_db,
    save_uploaded_photo,
)


class UploadStorageTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.app = Flask(__name__, root_path=self.tmpdir.name)
        self.app.config.update(
            TESTING=True,
            SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
            SUPABASE_URL="",
            SUPABASE_SERVICE_ROLE_KEY="",
            SUPABASE_STORAGE_BUCKET="evacway-uploads",
        )
        db.init_app(self.app)
        with self.app.app_context():
            UploadedFile.__table__.create(bind=db.engine, checkfirst=True)

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()
        self.tmpdir.cleanup()

    def test_db_fallback_serves_photo_even_without_local_file(self):
        sample_bytes = b"\x89PNG\r\n\x1a\nfake-png-bytes"
        file_storage = FileStorage(
            stream=io.BytesIO(sample_bytes),
            filename="landslide.png",
            content_type="image/png",
        )

        with self.app.app_context():
            url, meta = save_uploaded_photo(file_storage, "hazard", "resident_one")
            db.session.commit()

            self.assertTrue(url.startswith("/static/uploads/hazard/resident_one/"))
            self.assertEqual(meta["storage_mode"], "db")

            # Simulate another server (Render/localhost) that does NOT have the local file
            if meta["local_path"] and os.path.exists(meta["local_path"]):
                os.remove(meta["local_path"])

            subpath = url.removeprefix("/static/uploads/")
            stored = get_uploaded_file_from_db(subpath)
            self.assertIsNotNone(stored)
            data, content_type = stored
            self.assertEqual(data, sample_bytes)
            self.assertEqual(content_type, "image/png")

            # Also resolves by basename fallback
            basename_stored = get_uploaded_file_from_db(os.path.basename(subpath))
            self.assertIsNotNone(basename_stored)
            self.assertEqual(basename_stored[0], sample_bytes)

            # Cleanup works cleanly
            delete_uploaded_photo(meta)
            db.session.commit()
            self.assertIsNone(get_uploaded_file_from_db(subpath))

    def test_supabase_storage_used_when_configured(self):
        sample_bytes = b"\xff\xd8\xff\xe0fake-jpeg"
        file_storage = FileStorage(
            stream=io.BytesIO(sample_bytes),
            filename="rescue.jpg",
            content_type="image/jpeg",
        )
        fake_resp = MagicMock(status_code=200, text="ok")

        with self.app.app_context(), patch("services.upload_storage.requests.post", return_value=fake_resp) as post:
            self.app.config.update(
                SUPABASE_URL="https://example.supabase.co",
                SUPABASE_SERVICE_ROLE_KEY="test-service-key",
                SUPABASE_STORAGE_BUCKET="evacway-uploads",
            )
            url, meta = save_uploaded_photo(file_storage, "rescue", "jester")

            self.assertTrue(
                url.startswith("https://example.supabase.co/storage/v1/object/public/evacway-uploads/rescue/jester/")
            )
            self.assertEqual(meta["storage_mode"], "supabase")
            post.assert_called_once()


if __name__ == "__main__":
    unittest.main()
