import os
import sqlite3
from sqlmodel import SQLModel, create_engine, Session

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/lovable.db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

os.makedirs("data", exist_ok=True)

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args=connect_args,
)


def init_db():
    SQLModel.metadata.create_all(engine)
    apply_migrations()


def get_session():
    with Session(engine) as session:
        yield session


def apply_migrations():
    if not DATABASE_URL.startswith("sqlite:///"):
        return

    db_path = DATABASE_URL.replace("sqlite:///", "", 1)
    if not os.path.exists(db_path):
        return

    conn = sqlite3.connect(db_path)
    try:
        ensure_column(conn, "project", "owner_id", "TEXT NOT NULL DEFAULT 'local'")
        ensure_column(conn, "project", "auto_fix_enabled", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "chatmessage", "model_used", "TEXT")
        ensure_column(conn, "providerconfig", "owner_id", "TEXT NOT NULL DEFAULT 'local'")
        ensure_column(conn, "providerconfig", "api_key_encrypted", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "projecttemplate", "owner_id", "TEXT NOT NULL DEFAULT 'local'")
        normalize_owner_defaults(conn, "project", "owner_id")
        normalize_owner_defaults(conn, "providerconfig", "owner_id")
        normalize_owner_defaults(conn, "projecttemplate", "owner_id")
    finally:
        conn.close()


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str):
    # Whitelist of allowed table/column names to prevent SQL injection
    ALLOWED_MIGRATIONS = {
        ("project", "owner_id"),
        ("project", "auto_fix_enabled"),
        ("chatmessage", "model_used"),
        ("providerconfig", "owner_id"),
        ("providerconfig", "api_key_encrypted"),
        ("projecttemplate", "owner_id"),
    }
    if (table, column) not in ALLOWED_MIGRATIONS:
        return

    cursor = conn.execute(f"PRAGMA table_info({table})")
    columns = {row[1] for row in cursor.fetchall()}
    if column in columns:
        return

    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    conn.commit()


def normalize_owner_defaults(conn: sqlite3.Connection, table: str, column: str):
    ALLOWED_OWNER_TABLES = {"project", "providerconfig", "projecttemplate"}
    if table not in ALLOWED_OWNER_TABLES or column != "owner_id":
        return

    conn.execute(
        f"UPDATE {table} SET owner_id='local' WHERE owner_id IS NULL OR TRIM(owner_id)=''"
    )
    conn.commit()
