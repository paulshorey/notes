# MongoDB

```text
mongo;    
use whateverDatabaseYouWant;    
db.createUser({user:"paul",pwd:"",roles:["readWrite"]});    
db.createCollection("whateverCollection");    
db.whateverCollection.insert({"title":"whatever2"});    
db.whateverCollection.find();

use whatever;    
db.whatever.drop();
```

---

### **Install on Mac, for development**

and start in automatically [http://blog.colouringcode.com/starting-mongodb-automatically-on-mac-os-x/](http://blog.colouringcode.com/starting-mongodb-automatically-on-mac-os-x/)

### **Install on Linux \(Ubuntu 16\), for production \(and staging\)**

[https://www.howtoforge.com/tutorial/install-mongodb-on-ubuntu-16.04/](https://www.howtoforge.com/tutorial/install-mongodb-on-ubuntu-16.04/)

## 1\) Tweak

```text
#/etc/mongod.conf

storage:
  dbPath: /www/db

security:
  authorization: enabled
```

## 2\) Admin user

```text
mongod --dbpath="whatever"
mongo
show dbs #(should show it)
use admin
createUser({user:"admin",pwd:"secret!",roles:["root"])
```

```text
mongod --dbpath="whatever" --auth
mongo
show dbs #(should not show, but throw error)
use admin
db.auth("admin","secret!")
show dbs #(now will show dbs)
```

## 3\) Auto-run

```text
# on Linux
vim /etc/crontab

# on Mac
sudo touch /Library/LaunchDaemons/mongod.plist
sudo vim /Library/LaunchDaemons/mongod.plist

<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
        <key>KeepAlive</key>
        <true/>
        <key>Label</key>
        <string>mongod</string>
        <key>ProgramArguments</key>
        <array>
                <string>mongod</string>
                <string>--dbpath</string>
                <string>/www/db</string>
                <string>--auth</string>
                <string>--port</string>
                <string>54321</string>
        </array>
</dict>
</plist>
```





