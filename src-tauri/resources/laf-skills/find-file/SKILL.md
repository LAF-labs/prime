---
name: find-file
description: Looking for a file whose location the user does not know — "where is that contract", "I saved it somewhere last week". Where to look, in what order.
---

# Finding a file the user cannot locate

There is no search tool here. Finding something means listing folders in a
sensible order, and the order is what makes the difference between an answer in
four calls and giving up after ten.

## 1. Get what you can from the user's own words

Before listing anything, note what you already know: part of the name, the file
type, roughly when it was saved, what it was for. Each one narrows the search.

Do not ask for the full path. If the user knew it, they would not be asking.
One clarifying question is fine when you have nothing to go on — "roughly when
did you last open it?" beats a blind sweep.

## 2. Look in the obvious places first, in this order

1. The current working folder.
2. `~/Desktop` — where things land when someone is in a hurry.
3. `~/Downloads` — anything that arrived by mail, chat, or browser.
4. `~/Documents`.
5. The subfolder whose name matches the topic, once you can see one.

Use `list_dir` on each. Stop as soon as you find it; do not sweep the rest for
completeness.

## 3. Recognize it by more than its name

Listings show sizes and names. A file whose name is a camera code or a download
hash may still be the right one — match on file type and rough date too.

If several are plausible, do not guess. List the candidates with their full
locations and let the user pick. If one is clearly the best match and it is a
text, PDF, Word, or Excel file, `read_file` it and confirm from the contents
before saying it is the one.

## 4. When it is not there

Say where you looked, in plain words. Then say what would find it: a folder you
cannot reach (anything inside `~/Library`, or outside the home folder), an
external drive, or a different name than expected. Offer to look somewhere
specific rather than repeating the same sweep.

Never say a file does not exist. Say you did not find it in the places you
looked, and name them.
