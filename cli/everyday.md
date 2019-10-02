# Everyday

> open/edit a file in the terminal:  
> **`ne ~/.gitconfig`** using [Nice Editor](../ide/ne.md)  
> **`^s ^q`** save changes and exit  
> **`^q`**, then **`y`** to confirm exit without saving changes

[https://www.networkworld.com/article/3337516/the-linux-command-line-cheat-sheet.html](https://www.networkworld.com/article/3337516/the-linux-command-line-cheat-sheet.html)

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
