---
name: organize-files
description: Tidying, sorting, grouping or cleaning up a folder — "organize my Downloads", "sort these photos by year". Proposes a plan before moving anything.
---

# Organizing a folder

Moving someone's files is not reversible for them. The whole point of this
procedure is that they see the plan before it happens, and can recognize their
own files afterwards.

## 1. Look before you plan

Call `list_dir` on the folder. If it has subfolders the user mentioned, list
those too. Never plan from the folder's name or from what you assume is in it.

If it holds more than about 50 items, say how many there are and offer to start
with one kind of file, rather than reorganizing everything at once.

## 2. Group by what the names actually say

Look for the pattern the files themselves suggest — file type, a date in the
name, a project or client name, a naming prefix the user already uses. Prefer
the grouping the user would have made by hand.

If a file's kind is genuinely unclear from its name and the folder has few
enough files, `read_file` a couple to check. Do not read dozens of files to
sort them; ask instead.

Leave alone anything you cannot place. A leftover file in the original folder
is fine. A file filed under a guess is not — the user will look for it where
they last saw it.

## 3. Show the plan and stop

In one short message, before touching anything:

- the folders you would create, with the number of files going into each
- one or two example filenames per folder, so the user can sanity-check
- what you would leave where it is, and why

Then wait for an answer. Do not call `organize` in the same turn as the plan.

## 4. Do it

Use `organize` with `op: "move"`. Send the operations in one call — a batch of
40 moves is one approval for the user instead of forty.

Copy the file names character for character from the listing. Never translate a
name into another language, never re-spell it, never "fix" its capitalization
unless the user asked for a rename.

If some moves fail, keep the ones that worked and say plainly which did not.

## 5. Report

Say what moved, where, and what stayed behind. Name the leftovers.

You cannot delete files. When something looks like a duplicate or junk, list
those files and let the user delete them.
