# GIT Config  
  
1.  **Install ssh key on new device**  
    `echo "{paste your ssh key contents}" >> ~/.ssh/newssh  `  
    chmod -R 600 ~/.ssh/newssh  
  
2.  **then, every time the CLI starts:**  
    eval "$(ssh-agent -s)"  
    ssh-add ~/.ssh/newssh`  
  
#### Set a value in global config:  
```git config --global user.name Paul\ Shorey```  
Without `--global`, it edits local `./.git/config` file.  
  
#### Or edit `~/.gitconfig`:  
```  
[user]  
    git config --global color.ui true  
    git config --global user.name Paul\ Shorey  
    git config --global user.email ps@artspaces.net  
    git config --global push.default simple  
    git config --global core.editor=ne  
    git config --global submodule.recurse=true  
```  
  
  
  
