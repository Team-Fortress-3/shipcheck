import os
import json
from dotenv import load_dotenv
from openrouter import OpenRouter

load_dotenv()

class EmailClassifier:
    def __init__(self, model = "~typesafe/jev-latest", api_key = None):
        self.api_key = api_key or os.environ.get("OPENROUTER_API_KEY")
        self.model = model
        
        self.options = {
            "BL_COMPARISON": (
                "The email is CURRENTLY presenting a Shipping Instruction and a draft "
                "Bill of Lading TOGETHER and asking for them to be checked/compared "
                "against each other RIGHT NOW — e.g. 'Attached are the SI and draft BL "
                "for checking'. The email should reference or include BOTH documents "
                "as already available, not merely mention BL/SI terminology. "
                "Do NOT choose this for: (a) an email asking someone to SEND or "
                "PREPARE a draft BL so it CAN be checked later — e.g. 'Please assist "
                "to send the draft BL for [ref] for checking asap' is a REQUEST, not "
                "a comparison, since no document is being checked in this email; "
                "(b) a bulk status/reminder email like 'list of outstanding BL, please "
                "action the pending items' — this is a general reminder, not a request "
                "to check one specific SI against one specific BL. If attachments are "
                "empty, this is almost never BL_COMPARISON."
            ),
            "SI_REQUEST": "Request to prepare new shipping instructions (phrases like \"request SI/Shipping Instructions\" or \"find Shipping Instructions\".",
            "INVOICE_QUERY": (
                "The email is actively questioning, disputing, or requesting action on "
                "a charge, invoice amount, or payment — not merely mentioning the word "
                "'invoice' as one item in a document checklist (e.g. a list of required "
                "documents that includes 'Original invoice' is NOT itself an invoice "
                "query). An automated/system notification reporting that a billing "
                "process completed successfully with no action needed is GENERAL, not "
                "INVOICE_QUERY."
            ),
            "GENERAL": (
                "Operational correspondence that doesn't fit the other categories — "
                "including requests to send/prepare a draft BL for future checking, "
                "bulk status updates or reminders about outstanding documents, and "
                "automated/system-generated notifications."
            ),
            "SPAM": "Unsolicited advertising, promotional campaigns, phishing, or scams"
        }
        self.instructions = (
            "Which category best classifies this inbound email for a shipping "
            "operations team? Judge by what the email is actually asking for RIGHT "
            "NOW, not by which shipping-related keywords appear in it."
        )
        
    
    def build_choice_question(self, instructions: str, criteria: dict[str, str]) -> dict:
        """Helper to build a Jev choice question payload."""
        return {
            "type": "choice",
            "instructions": instructions,
            "criteria": criteria,
        }


    def classify_email(
        self,
        state: dict | str,
        api_key: str | None = None,
    ):
        """
        Classifies an email using Jev decision model via OpenRouter's alpha.decisions endpoint.

        Args:
            state: Email data (dict or string) to evaluate.
            questions: Schema of questions and criteria. If None, uses default choice question.
            model: OpenRouter model identifier (default: ~typesafe/jev-latest).
            api_key: OpenRouter API key. If None, reads from OPENROUTER_API_KEY environment variable.

        Returns:
            DecisionsResponse object containing answers and probability distributions.
        """
        resolved_api_key = api_key or os.environ.get("OPENROUTER_API_KEY")
        if not resolved_api_key:
            raise ValueError(
                "OPENROUTER_API_KEY is not set. Please set it in your .env file or pass it to classify_email()."
            )

        QUESTION_KEY = "category"
        
        questions = {
            QUESTION_KEY: self.build_choice_question(
                instructions=self.instructions,
                criteria=self.options,
            )
        }

        with OpenRouter(api_key=resolved_api_key) as client:
            response = client.alpha.decisions.create(
                model=self.model,
                state=state,
                questions=questions,
            )
            return response

# --- State Definition ---
# Jev accepts a plain string, dictionary, or list representing the input state to evaluate.
# Replace / paste your email state here:
SAMPLE_STATE = {
    "email_id": "email_206",
    "from": "support@webmail-verify.co",
    "subject": "Dear Valued Customer, update your account to avoid suspension",
    "body": "CONGRATULATIONS!!! Your email address has been selected in our monthly draw. Click here to claim your $1,000 gift card now: http://bit.ly/claim-prize-now",
    "attachments": []
}

def main():
    classifier = EmailClassifier()
    
    print(f"Using model: {classifier.model}")
    print("State to classify:")
    print(json.dumps(SAMPLE_STATE, indent=2))
    print("-" * 50)
    
    try:
        response = classifier.classify_email(state=SAMPLE_STATE)
    except ValueError as e:
        print(f"\n[Configuration Notice]: {e}")
        print("To run this classifier, ensure OPENROUTER_API_KEY is present in your .env file.")
        return
    except Exception as e:
        print(f"\n[Error calling OpenRouter]: {e}")
        return

    print("\nClassification Results:")
    for q_key, answer in response.answers.items():
        print(f"\nQuestion: {q_key}")
        if answer.type == "choice":
            print(f"  Selected Choice : {answer.choice}")
            print(f"  Confidence      : {answer.confidence:.4f}" if answer.confidence is not None else "  Confidence      : N/A")
            if answer.probabilities:
                print("  Probabilities:")
                for opt, prob in sorted(answer.probabilities.items(), key=lambda x: x[1], reverse=True):
                    print(f"    - {opt}: {prob:.4f}")
        else:
            print(f"  Answer: {answer}")

    if response.usage:
        print(f"\nTokens used: input={response.usage.input_tokens}, output={response.usage.output_tokens}")


if __name__ == "__main__":
    main()