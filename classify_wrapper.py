from classifier import EmailClassifier

_classifier = EmailClassifier()

def classify_email(email: dict) -> str:
    response = _classifier.classify_email(email)
    return response.answers["category"].choice