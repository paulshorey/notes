# Config a new Ubuntu

**Digital Ocean's basics:**  
[https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-16-04](https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-16-04)

**My settings:**  
Install ZSH and OH-MY-ZSH, and Nice Editor

Change startup options for CLI:  
in `~/.zprofile` or `.bashrc` if you did not install ZSH

List running node processes:  
`ps cax | grep node`

Then see more details about each process:  
`ps -Flww -p THE_PID`

**on Login:**  
Copy the following to the bottom of `~/.zprofile`

```text
eval "$(ssh-agent -s)"; 
ssh-add ~/.ssh/newssh

cd /www/$(hostname); 
git reset HEAD --hard; 
git pull

ps cax | grep node;
echo "TIPS:" 
echo "vim /etc/nginx/sites-available/default"; 
echo "service nginx restart";
```

**on Startup or on Schedule:**   
Add something like the following to the bottom of `/etc/crontab`:

```text
30 2   1 root bash /www/ps-api/_cron/weekly.sh 
@reboot root bash /www/ps-api/_cron/db.sh 
@reboot root bash /www/ps-api/_cron/api.sh 
@reboot root bash /www/ps-api/_cron/deploy.sh
```

**NOTE:** the "/www/ps-api" in this path - replace this with the path to your project. Unfortunately, the neat trick to automatically use the server name `$(hostname)` does not work in this Cron file. 

**PROBLEM:** how to put `/etc/crontab` and `~/.zprofile` settings into version control

