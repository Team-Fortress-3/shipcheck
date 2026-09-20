"""
Database configuration and session management for ShipCheck SQLite persistence.
"""
import os
from pathlib import Path
from typing import Generator
from sqlmodel import SQLModel, create_engine, Session

DB_PATH = Path(__file__).resolve().parent.parent / "shipcheck.db"
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DB_PATH}")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)


def init_db(target_engine=None) -> None:
    """Initializes database tables if they do not exist."""
    import api.models  # noqa: F401
    SQLModel.metadata.create_all(target_engine or engine)


# Initialize default database tables
init_db()


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency providing a database session."""
    with Session(engine) as session:
        yield session

