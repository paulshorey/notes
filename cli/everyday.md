# Everyday

> best in-terminal text editor (alternative to vim):  
> **`ne ~/.gitconfig`** using [Nice Editor](../ide/ne.md)  
> **`^s ^q`** save changes and exit  
> **`^q`**, then **`y`** to confirm exit without saving changes

[https://www.networkworld.com/article/3337516/the-linux-command-line-cheat-sheet.html](https://www.networkworld.com/article/3337516/the-linux-command-line-cheat-sheet.html)

## Switch directories
**`pushd .`** # save current working directory
**`popd`** # go back to saved directory

## Chown command

```text
chown owner-user file 
chown owner-user:owner-group file
chown owner-user:owner-group directory
chown options owner-user:owner-group file
```

**`sudo chown -R $(id -u):$(id -g) .`** take ownership of . directory

## Running processes

```
ps -ef     # list all running processes
ps -ef | grep node      # list only "node" processses
```

## Networking

**`dig +short myip.opendns.com @resolver1.opendns.com`** see public IP address
