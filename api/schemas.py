"""
Pydantic schemas directly matching the ShipCheck React frontend TypeScript contracts.
"""
from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, Field

# Matches TypeScript union types from frontend
EmailType = Literal[
    "Document Comparison", "New SI Request", "Invoice Query", "General", "Spam"
]

EmailStatus = Literal[
    "New", "Mismatch", "Match", "Needs Review", "Classified", "Processing"
]


class EmailClassifyRequest(BaseModel):
    """Payload sent by the frontend to classify an email."""
    subject: str = Field(..., description="Email subject line")
    snippet: str = Field(default="", description="Short preview snippet of email")
    body: str = Field(default="", description="Full or partial email body")


class EmailClassifyResponse(BaseModel):
    """Response returned to the frontend with classification type and confidence."""
    type: EmailType
    confidence: float
    reasoning: Optional[str] = None


class ComparisonField(BaseModel):
    """Represents extraction and comparison for a single shipping field."""
    field: str = Field(..., description="Human-readable field name, e.g. 'Shipper'")
    si: str = Field(..., description="Extracted value from SI document or '—'")
    bl: str = Field(..., description="Extracted value from BL document or '—'")
    match: bool = Field(..., description="True if SI and BL match")


class CompareResponse(BaseModel):
    """Response returned to the frontend after document comparison."""
    status: EmailStatus  # "Match", "Mismatch", or "Needs Review"
    fields: List[ComparisonField]
    summary: Optional[str] = None


class CompareTextRequest(BaseModel):
    """Direct text-based comparison payload."""
    si_text: str = Field(..., description="Raw text of Shipping Instruction")
    bl_text: str = Field(..., description="Raw text of Bill of Lading")


class HealthResponse(BaseModel):
    """Health check payload."""
    status: str
    version: str
    providers: Dict[str, bool]

