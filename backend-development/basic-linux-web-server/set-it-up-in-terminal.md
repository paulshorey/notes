# Set it up in Terminal

**Setup** server

```text
apt update -y;
apt upgrade -y;

apt install ne -y;

mkdir /www;
mkdir /www/secret;

echo 'eval "$(ssh-agent -s)"' >> ~/.profile;
echo 'ssh-add /www/secret/newssh' >> ~/.profile;
echo 'cd /www' >> ~/.profile;
```

To allow **GIT ACCESS**, copy SSH key from local to remote  
`scp newssh root@142.93.251.57:/www/files` \(do this on local\)

or, **DO THIS ON REMOTE:**

```text
echo ' ... file contents ... ' >> /www/secret/newssh;
```

Initial copy from **GIT**

```text
source ~/.profile;
git clone git@github.com:yourname/yourrepo.git name;
```

Run on startup

```text
echo '@reboot root bash /www/name/_startup/deploy.sh' >> /etc/crontab;
```

Install Node/NPM

```text
sudo apt-get install curl;
curl -sL https://deb.nodesource.com/setup_13.x | sudo -E bash -;
sudo apt install nodejs -y;
```

Serve

```text
bash /www/name/_startup/serve.sh
```



