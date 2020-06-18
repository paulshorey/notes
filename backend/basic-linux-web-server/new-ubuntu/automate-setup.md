---
description: >-
  On Ubuntu ... First, see how to connect using SSH + password, install SSH
  public key to remote, then disable password authentication, for security. Do
  this manually, when connecting to each IP.
---

# automate setup

```
#
# One time, new server setup...
#
apt update
apt install ne
apt install -y zsh
chsh -s $(which zsh)
apt install curl
apt install git
sh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"

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
# Install specific Node version
#
# note the "$(dpkg --print-architecture)" inside this link
wget -P /tmp https://deb.nodesource.com/node_13.x/pool/main/n/nodejs/nodejs_13.12.0-1nodesource1_$(dpkg --print-architecture).deb
apt install rlwrap
dpkg -i /tmp/nodejs_13.12.0-1nodesource1_$(dpkg --print-architecture).deb





```





