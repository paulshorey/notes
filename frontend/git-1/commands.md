# basics

### Merge conflicts...

`git checkout --theirs .` keep changes from OTHER branch, the one being merged INTO the one you're on  
`git checkout --ours .` keep changes from the branch you're currently on

### Updating:

**`git pull`** actually does **`git fetch; git merge`**

**`git pull --rebase`**does not leave behind so many "merge" commits, making for a cleaner git history. It combines your commits and remote commits without making a new commit for the merge.  
[https://www.atlassian.com/git/tutorials/syncing/git-pull](https://www.atlassian.com/git/tutorials/syncing/git-pull)

### Extras:

**`git remote show origin`** show url of remote repository

