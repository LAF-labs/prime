---
name: build-knowledge
description: Saving what a document or conversation established into the knowledge base — distilled, linked notes future chats can answer from.
---

# Compiling knowledge into the knowledge base

The user wants something they read or discussed to be *known* from now on —
"이 계약 내용 저장해둬", "이 프로젝트 정리해서 기억해". The knowledge base is
a set of small linked notes; future conversations search it before re-reading
original files.

## 1. Search before saving

`knowledge_search` for the main entities first. If a note already exists,
update it (`knowledge_save` with the same name replaces it) instead of
creating a near-duplicate. One topic, one note.

## 2. Distill, never transcribe

A note is what a future conversation needs to answer questions — not a copy
of the document. For a contract: parties, amounts, dates, obligations,
termination terms. For a project: goal, status, people, next steps. Aim for
under half a page. The original stays on disk; the note ends with a
`source:` line giving its path, so the full text is one `read_file` away.

## 3. Split by entity and link with [[...]]

One note per thing — a project, a client, a contract, a person. Where notes
relate, write the other note's name as `[[note-name]]` in the text. Links
are what make the base a graph instead of a pile:

```
# 케이리뷰 유지보수 계약

updated: 2026-08-14
source: ~/Downloads/KReview_유지보수_표준계약서.docx

발주자 [[케이리뷰]]와 총 1,600만 원, 8주(1차 4주 + 2차 4주).
담당: [[김기범]]. 잔금 조건은 검수 완료 후 14일.
```

## 4. Names are for finding, not filing

Note names should be the words the user would search: "케이리뷰-계약", not
"contract-2026-08-doc1". Korean names are fine.

## 5. Tell the user what was saved

List the note names you created or updated, in one line each. If the base is
getting full (the tool will say so), tell them rather than silently failing.
