"""
AI-assisted comparison for the TEXT fields only (shipper, consignee,
notify_party, port_of_loading, port_of_discharge) — NOT the numeric fields
(container_count, gross_weight_kg), which have no "same meaning, different
wording" ambiguity and stay on deterministic comparison.

Design: this is a second-pass check, only invoked when the cheap
deterministic normalize-and-compare already disagrees. If normalize()
already says two values are equal, we never spend an API call confirming
it. This keeps cost down while fixing the real failure mode: formatting
differences (separators, line breaks, address component order) causing
false MISMATCH flags on values that are actually identical.

Critical: this must NOT get too lenient. A matching abbreviation/code with
a genuinely different named place (e.g. two documents both saying "(KEMBA)"
but one says Mombasa, Kenya and the other says Tuticorin, India) must still
come back as a real mismatch — see the test cases in verify_compare_ai.py.
"""
import anthropic

MODEL = "claude-haiku-4-5-20251001"

TEXT_FIELDS = ["shipper", "consignee", "notify_party", "port_of_loading", "port_of_discharge"]

COMPARE_TOOL = {
    "name": "compare_field_values",
    "description": "Judge whether each pair of field values refers to the same real-world entity or place.",
    "input_schema": {
        "type": "object",
        "properties": {
            "comparisons": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string"},
                        "same": {
                            "type": "boolean",
                            "description": "true only if both values refer to the same real-world entity/place, allowing for formatting differences (separators, line breaks, word order, abbreviations, punctuation).",
                        },
                        "reasoning": {"type": "string"},
                    },
                    "required": ["field", "same", "reasoning"],
                },
            },
        },
        "required": ["comparisons"],
    },
}

SYSTEM_PROMPT = """You judge whether two extracted field values refer to the same \
real-world company or place, despite superficial formatting differences \
between two source documents (different separators like "|" vs newlines, \
different address component order, abbreviations vs full names, minor \
punctuation differences).

Mark "same": true only when you are confident they refer to the identical \
entity or place — formatting differences alone should not cause a "false" \
verdict.

Mark "same": false whenever the actual identity differs — a different \
company name, a different city, a different country — even if the values \
share a superficial similarity like a matching code, abbreviation, or \
partial text overlap. A shared code or abbreviation does NOT override an \
actual difference in the named entity. When genuinely uncertain, prefer \
"same": false — a real system should escalate rather than silently forgive \
a possible defect."""


def compare_text_fields_ai(
    si_fields: dict, bl_fields: dict, fields_to_check: list[str], client: anthropic.Anthropic | None = None
) -> dict:
    """Returns {field: {"same": bool, "reasoning": str}} for each field in
    fields_to_check. Only call this for fields where deterministic
    comparison already disagreed."""
    if not fields_to_check:
        return {}

    client = client or anthropic.Anthropic()

    pairs_text = "\n\n".join(
        f'Field: {f}\nSI value: {si_fields.get(f)!r}\nBL value: {bl_fields.get(f)!r}'
        for f in fields_to_check
    )

    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        tools=[COMPARE_TOOL],
        tool_choice={"type": "tool", "name": "compare_field_values"},
        messages=[{"role": "user", "content": f"Compare these field value pairs:\n\n{pairs_text}"}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "compare_field_values":
            return {c["field"]: {"same": c["same"], "reasoning": c["reasoning"]} for c in block.input["comparisons"]}

    raise RuntimeError("Claude did not return the expected tool call")


def normalize(value):
    if value is None:
        return None
    text = str(value).strip().upper()
    # treat common separators as equivalent so formatting alone doesn't cause a mismatch
    for sep in ["|", ";", "\n"]:
        text = text.replace(sep, ",")
    text = text.replace(",", " ")
    return " ".join(text.split())


def compare_fields_hybrid(si_fields: dict, bl_fields: dict, all_fields: list[str], client=None) -> tuple[list[str], dict]:
    """Returns (defect_fields, ai_reasoning) where ai_reasoning holds the
    explanation for any field that needed the AI second pass."""
    defect_fields = []
    disagreeing_text_fields = []

    for field in all_fields:
        si_val = normalize(si_fields.get(field))
        bl_val = normalize(bl_fields.get(field))
        if si_val != bl_val:
            if field in TEXT_FIELDS:
                disagreeing_text_fields.append(field)
            else:
                defect_fields.append(field)  # numeric fields: trust deterministic

    ai_reasoning = {}
    if disagreeing_text_fields:
        ai_results = compare_text_fields_ai(si_fields, bl_fields, disagreeing_text_fields, client)
        for field in disagreeing_text_fields:
            result = ai_results.get(field, {"same": False, "reasoning": "AI comparison did not return a verdict"})
            ai_reasoning[field] = result["reasoning"]
            if not result["same"]:
                defect_fields.append(field)

    return defect_fields, ai_reasoning