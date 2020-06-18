---
description: >-
  On Ubuntu ... First, see how to connect using SSH + password, install SSH
  public key to remote, then disable password authentication, for security. Do
  this manually, when connecting to each IP.
---

# automate setup

```
# One time, new server...
apt update
apt install ne
apt install -y zsh
chsh -s $(which zsh)
apt install curl
apt install git
sh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"

# On login, each time...
mkdir /www
echo 'cd /www;' > ~/.zprofile
echo 'eval $(ssh-agent -s);' > ~/.zprofile
echo 'ssh-add ~/.ssh/newssh;' > ~/.zprofile



```

