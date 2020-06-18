---
description: >-
  On Ubuntu ... First, see how to connect using SSH + password, install SSH
  public key to remote, then disable password authentication, for security. Do
  this manually, when connecting to each IP.
---

# automate setup



```
#
# New server setup...
#
cd /tmp
apt update
apt install ne
apt install -y zsh
chsh -s $(which zsh)
apt install curl
apt install git
sh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"

#
# Install specific Node version
#
# note the "$(dpkg --print-architecture)" inside this link
wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.35.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
nvm install 13.12.0

#
# On login, each time...
#
mkdir /www
echo 'cd /www;' > ~/.zprofile
echo 'eval $(ssh-agent -s);' > ~/.zprofile
echo 'ssh-add ~/.ssh/newssh;' > ~/.zprofile   # whatever SSH key is used in Github

#
# Load new login config, and continue with new server setup...
#
source ~/.zprofile
git clone git@github.com:paulshorey/nlp.domains.git /www/nlp.domains

#
# Nginx + SSL
#
apt install nginx -y
apt install ufw -y
ufw allow 'Nginx Full'



```





