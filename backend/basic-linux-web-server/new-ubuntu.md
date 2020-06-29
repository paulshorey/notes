---
description: >-
  On Ubuntu ... First, connect using SSH + password, install SSH public key to
  remote, then disable password authentication, for security. Do this manually,
  when connecting to each IP.
---

# Server configuration

**Automate setup:**

```
#
# New server setup...
#
cd /tmp
apt update
apt install ne -y
apt install -y zsh
chsh -s $(which zsh)
apt install curl -y
apt install git -y
sh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"
# how to automatically say "yes"? chsh did not do the trick

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
# Change directory, print out some instructions...
#
mkdir /www
echo "\n\
cd /www/nlp.domains;\n\
eval \$(ssh-agent -s);\n\
ssh-add ~/.ssh/newssh;\n\
echo '\\\n\
    NGINX:\\\n\
    ne /etc/nginx/sites-available/default\\\n\
    service nginx restart\\\n\
';\
" > ~/.zprofile

#
# Load new login config, and continue with new server setup...
#
source ~/.zprofile
git clone git@github.com:paulshorey/nlp.domains.git /www/nlp.domains
# how to automatically say "yes"?

#
# Nginx + SSL
#
apt install nginx -y
apt install ufw -y
ufw allow 'Nginx Full'
echo "\
  server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name nlp.domains www.nlp.domains;
  
    return 301 https://\$server_name\$request_uri;
  }
  
  server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name nlp.domains www.nlp.domains;
  
    ssl on;
    ssl_certificate /www/ssl/server.crt;
    ssl_certificate_key /www/ssl/server.key;
  
    #access_log /var/log/nginx/nginx.vhost.access.log;
    #error_log /var/log/nginx/nginx.vhost.error.log;
  
    location / {
      root /www/nlp.domains/public;
      index index.html;
    }
  }
" > /etc/nginx/sites-available/default

#
# Crontab
#
echo "\
@reboot root bash /www/nlp.domains/_startup/start.sh\
" >> /etc/crontab

#
# Codebase
#
cd /www
rm -rf /www/nlp.domains
git clone git@github.com:paulshorey/nlp.domains.git nlp.domains

```

