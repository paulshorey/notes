# Everyday

### Switch directories

**`pushd .`** \# save current working directory **`popd`** \# go back to saved directory

## Change ownership

**`sudo chown -R $(id -u):$(id -g) .`** take ownership of . directory, recursively

#### Change permissions

**`chmod 400 ~/.ssh/awsssh.pem`** to give a file specific permissions

## Running processes

**`ps -ef`** list all running processes  
**`ps -ef | grep node`** list only "node" processes  
**`lsof -i :4321`** find PID of running process  
**`kill 123`** kill process by PID

## Process on port

**`netstat -vanp tcp | grep 3000`** find all processes using port 3000  
**`sudo lsof -i tcp:3000`** on macOS El Capitan+, this may work better

## Networking

**`dig +short myip.opendns.com @resolver1.opendns.com`** see public IP address

