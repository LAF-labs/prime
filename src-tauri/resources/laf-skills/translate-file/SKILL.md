---
name: translate-file
description: Translating a document into another language and saving the result as a new file, keeping the original untouched.
---

# Translating a document into a new file

## 1. Read, then translate, then save

`read_file` the source. Translate the whole text — not a summary of it —
into the language the user asked for. Save with `write_file` as
`<원본이름>-<언어>.md` next to the original. Never overwrite the source.

For a long document that arrives cut off, translate what was served and say
plainly which part is missing; offer to continue with the ending
(`part: "end"`).

## 2. What stays untranslated

- Proper nouns, product names, and codes stay as written unless the user
  says otherwise; put a translation in parentheses on first mention when it
  helps.
- Numbers, dates, and amounts are copied exactly — a translation error in a
  number is worse than no translation.
- Formatting (headings, lists, tables) is preserved as markdown.

## 3. Tone

Ask one question only if the target audience is unclear AND the document is
outward-facing (a letter, an announcement): 존댓말 or plain register, formal
or friendly. Internal notes default to plain.

## 4. Say what a translation cannot promise

For contracts and legal documents, end with one line: this is a working
translation, not a certified one.
