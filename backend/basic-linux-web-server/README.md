# Linux Web server

[Setup SSH](ssh.md) for access

Upload some initial/configuration files to the server \(from local\):  
\* `scp -r public/_server root@178.128.233.183:~`  
\* `scp -r public/_nginx root@178.128.233.183:~`   
\* `scp -r public/_certs root@178.128.233.183:~`   
\* `scp -r ~/.ssh/newssh root@178.128.233.183:~/.ssh/newssh`  

Use the newly uploaded files \(on remote\):  
\* `mv /tmp/_server/zprofile ~/.zprofile`   
\* `source ~/.zprofile`    
\* `bash /tmp/_server/install`  

Clone files to serve  
`cd /srv`   
`git clone git@github.com:paulshorey/public.git` 

Setup Nginx  
Note: in these config files, all paths have to be absolute. No `~`  
\* `mv _nginx/* /etc/nginx/sites-available`   
\* `mv /etc/nginx/sites-available/default /etc/nginx/sites-available/example`   
\* `mv /etc/nginx/sites-available/default /etc/nginx/sites-available/example`   
Symbolic link all the files, except default, which is already linked...  
\* `ln -s /etc/nginx/sites-available/paulshorey.com /etc/nginx/sites-enabled`   
\* `service nginx restart` 

Crontab  
Put whatever bash scripts, run by a specific user, to run whenever the server boots:  
`@reboot root bash /srv/public/_start.sh` 



