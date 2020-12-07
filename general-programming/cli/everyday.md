# Everyday

#### Change directory \(cd\) pro tip:

**`pushd .`** to remember current working directory, **`popd`** to go back to that directory

**Copy** command output **to memory**  `pwd | pbcopy` \(on Mac\)  
There's also pasting to a command `cd $(pbpaste)`   
On Linux, [here's a guide to copy/paste between memory and files](https://www.systutorials.com/copying-output-of-commands-in-linux-terminals-to-x-selection-clipboard/)

**Also this format:**  
`pbcopy < ~/.ssh/myssh.pub` copy contents of file  
`pbpaste` paste, or use paste to file: `pbpaste > myssh.pub` 

## Permissions

**`sudo chown -R $(id -u):$(id -g) .`** take ownership of . directory, recursively

#### Change permissions for a file

**`chmod 400 ~/.ssh/awsssh.pem`** to give a file specific permissions  
add `-R` to do it recursively for a folder

## Running processes

**`ps -ef`** list all running processes  
**`ps -ef | grep node`** list only "node" processes  
**`lsof -i :4321`** find PID of running process  
**`kill 123`** kill process by PID

## Process on port

**`netstat -vanp tcp | grep 3000`** find all processes using port 3000  
process id is 3rd large number leftward, or 4th column from the right

**`sudo lsof -i tcp:3000`** on macOS El Capitan+, this may work better

## Networking

**`dig +short myip.opendns.com @resolver1.opendns.com`** see public IP address

