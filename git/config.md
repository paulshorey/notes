# config

1. **Install ssh key on new device**  

   **`echo "{paste your ssh key contents}" >> ~/.ssh/newssh`**  

   chmod -R 600 ~/.ssh/newssh  

   

2. **then, every time the CLI starts:**  

   **`eval "$(ssh-agent -s)"`**  

   **`ssh-add ~/.ssh/newssh`**  

## Set a value in global config:

`git config --global user.name Paul Shorey`  
**Without** `--global`**, it edits local** `./.git/config` **file.**

## Or edit **`~/.gitconfig`**:

```text
[user]  
    git config --global color.ui true  
    git config --global user.name Paul\ Shorey  
    git config --global user.email ps@artspaces.net  
    git config --global push.default simple  
    git config --global core.editor=ne  
    git config --global submodule.recurse=true
```

## Shortcuts
These shortcuts are similar to `Magit` for Emacs, though much less sophisticated. Haha. But, they've been getting the job done for me for years. Limitations: 1) no multiline commit messages 2) no rebase. But, see the code, it automates everything else very nicely:
[Download .aliases.sh](https://github.com/paulshorey/notes/raw/master/files/linked/.aliases.sh)
