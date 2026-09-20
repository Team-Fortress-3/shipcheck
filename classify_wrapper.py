"""Wrapper around EmailClassifier for legacy or simple functional calls."""
from classifier import ClassificationResult, EmailClassifier

_classifier = EmailClassifier()


def classify_email(email: dict) -> str:
    """Classify an email and return its category string."""
    result: ClassificationResult = _classifier.classify(email)
    return result.category