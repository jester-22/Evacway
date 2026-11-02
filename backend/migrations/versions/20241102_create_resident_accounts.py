"""Create resident_accounts table for resident authentication.

Revision ID: 20241102_create_resident_accounts
Revises:
Create Date: 2024-11-02
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20241102_create_resident_accounts'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Create resident_accounts table
    op.create_table(
        'resident_accounts',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True, autoincrement=True),
        sa.Column('resident_id', sa.Integer(), nullable=False, unique=True),
        sa.Column('email', sa.String(120), nullable=False),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, default=True, server_default='true'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()'), onupdate=sa.text('now()')),
        sa.ForeignKeyConstraint(['resident_id'], ['residents.id'], ondelete='CASCADE'),
    )

    # Create unique index on email for active accounts
    op.create_index(
        'ix_resident_accounts_email_active',
        'resident_accounts',
        ['email'],
        unique=True,
        postgresql_where=sa.text('is_active = true')
    )

    # Create index on resident_id for FK lookups
    op.create_index(
        'ix_resident_accounts_resident_id',
        'resident_accounts',
        ['resident_id'],
        unique=True
    )


def downgrade():
    op.drop_index('ix_resident_accounts_resident_id', table_name='resident_accounts')
    op.drop_index('ix_resident_accounts_email_active', table_name='resident_accounts')
    op.drop_table('resident_accounts')