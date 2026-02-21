import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field, Relationship


def utcnow():
    return datetime.now(timezone.utc)


def new_uuid():
    return str(uuid.uuid4())


class Project(SQLModel, table=True):
    id: str = Field(default_factory=new_uuid, primary_key=True)
    owner_id: str = Field(default="local", index=True)
    name: str
    description: Optional[str] = None
    auto_fix_enabled: bool = True
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    files: list["ProjectFile"] = Relationship(
        back_populates="project",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    messages: list["ChatMessage"] = Relationship(
        back_populates="project",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class ProjectFile(SQLModel, table=True):
    id: str = Field(default_factory=new_uuid, primary_key=True)
    project_id: str = Field(foreign_key="project.id")
    filename: str
    content: str = ""
    language: Optional[str] = None
    updated_at: datetime = Field(default_factory=utcnow)

    project: Optional[Project] = Relationship(back_populates="files")


class ChatMessage(SQLModel, table=True):
    id: str = Field(default_factory=new_uuid, primary_key=True)
    project_id: str = Field(foreign_key="project.id")
    role: str  # "user", "assistant", "system"
    content: str
    created_at: datetime = Field(default_factory=utcnow)
    model_used: Optional[str] = None

    project: Optional[Project] = Relationship(back_populates="messages")


class FileSnapshot(SQLModel, table=True):
    id: str = Field(default_factory=new_uuid, primary_key=True)
    project_id: str = Field(foreign_key="project.id")
    filename: str
    content: str
    generation_id: str
    created_at: datetime = Field(default_factory=utcnow)


class Generation(SQLModel, table=True):
    id: str = Field(default_factory=new_uuid, primary_key=True)
    project_id: str = Field(foreign_key="project.id")
    user_message: str
    files_changed: str
    created_at: datetime = Field(default_factory=utcnow)


class ProjectTemplate(SQLModel, table=True):
    id: str = Field(default_factory=new_uuid, primary_key=True)
    owner_id: str = Field(default="local", index=True)
    name: str
    description: str
    prompt: str
    thumbnail: Optional[str] = None
    tags: str
    is_builtin: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class CollaborationSession(SQLModel, table=True):
    id: str = Field(default_factory=new_uuid, primary_key=True)
    project_id: str = Field(foreign_key="project.id")
    owner_id: str
    users: str
    created_at: datetime = Field(default_factory=utcnow)


class ProviderConfig(SQLModel, table=True):
    id: str = Field(default_factory=new_uuid, primary_key=True)
    owner_id: str = Field(default="local", index=True)
    name: str
    provider: str
    model: str
    base_url: Optional[str] = None
    api_key_encrypted: str = ""
    api_key: str = ""
    is_active: bool = False
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
