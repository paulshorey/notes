# Everyday

### Switch directories

**`pushd .`** \# save current working directory **`popd`** \# go back to saved directory

### Chown command

```text
chown owner-user file 
chown owner-user:owner-group file
chown owner-user:owner-group directory
chown options owner-user:owner-group file
```

**`sudo chown -R $(id -u):$(id -g) .`** take ownership of . directory

### Running processes

```text
ps -ef     # list all running processes
ps -ef | grep node      # list only "node" processses

lsof -i :4321    # find PID of running process
kill 123    # kill process by PID
```

### Networking

**`dig +short myip.opendns.com @resolver1.opendns.com`** see public IP address

