# GIT

What current repository?

```text
git config --get remote.origin.url
```

Undo add file? Before commit, do

`git reset <filename (optional)>` 

#### Merge conflict? Easy. Remember this trick:

`git checkout --theirs src/path/to/file/or/folder` This keeps the changes from the branch you are merging from the feature branch IN TO the current branch.

`git checkout --ours src/path/to/file/or/folder` Likewise, this keeps changes from the current branch, and ignores changes from the feature branch.







