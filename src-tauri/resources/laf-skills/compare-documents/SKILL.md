---
name: compare-documents
description: Comparing two versions of a document — draft vs signed contract, last vs this month's report. What changed, in plain words.
---

# Comparing two versions of a document

The user has two files that are almost the same thing — draft and final,
v1 and v2 — and wants to know what changed. The stakes are usually real:
a contract clause, a price, a deadline.

## 1. Read both files completely

`read_file` each one. For long documents remember the tool serves the
beginning and the end with the middle marked as skipped — if the changes
could be in the middle, say that the middle was not compared rather than
implying a full comparison.

If both are plain text (.md, .txt), `diff` via the shell is allowed and
faster; explain it as "comparing the two files". PDF/Word/HWP must be
compared from their extracted text.

## 2. Report differences by what they mean, not where they are

Group into:

1. **Numbers and dates** — amounts, percentages, deadlines, terms. These come
   first; they are why the user is asking. Quote both versions exactly:
   "계약금: 1,600만 원 → 1,800만 원".
2. **Added or removed sections** — name what the section is about.
3. **Reworded but same meaning** — one line saying so, no detail unless asked.

Never paraphrase both versions of a changed clause into sameness — when the
wording differs and it is a contract, quote both and let the user judge.

## 3. Say what was NOT checked

Formatting, signatures, stamps, and images do not survive text extraction.
End with one line naming that limit when the documents are contracts.
