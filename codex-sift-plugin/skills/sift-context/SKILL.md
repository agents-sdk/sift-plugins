---
name: sift-context
description: Use when a Codex tool result contains a <<stash:KEY>> marker, when the user asks how much context Sift saved, or when diagnosing the Codex Sift plugin.
---

# Sift context compression

Sift may replace a very large local tool result with a shorter equivalent or a lossy summary. Lossy summaries include a `<<stash:KEY>>` marker.

- Continue from the compressed result when it contains enough evidence.
- Call `sift_retrieve` with the marker only when omitted detail is required.
- If retrieval says the entry expired or is missing, rerun the original tool once; do not loop on retrieval.
- Call `sift_stats` when the user asks for token savings. Prefer the current `session_id` if it is known; otherwise report the all-session total returned by the tool.
- Sift's number is an estimate made with its tokenizer. Describe it as saved context tokens, not as a billing guarantee.
