---  
description: >-  
  A very powerful text editor. Unfortunately it has a pretty steep learning  
  curve. Here are some instructions to get up and running faster.  
---  
  
# EDITOR=emacs  
  
## First time setup:  
  
**Auto-install packages in .emacs**  
`M-x` `package-install` `use-package` required on new configurations to use 'use-package' in .emacs  
  
**.emacs**  
`C-x C-f C-f` `~/.emacs` open .emacs  
  
## Key Bindings  
  
**Switching between files**  
`C-x b` switch to buffer  
`C-x C-b` `C-x o` open list of buffers  
`C-x k` kill buffer  
`C-x 0` maximize buffer  
`C-x C-f` open file  
`C-x C-f C-f` `/root@host:/path` open remote file via SSH/SCP/Tramp  
  
**Preferences**  
`M-x` `customize-group` enter config GUI  
  
**List of buffers**  
`C-x C-b` `C-x o` `d` schedule buffer for deletion \(Dired\)  
`C-x C-b` `C-x o` `u` undo Dired  
`C-x k` close buffer, delete all Dired buffers  
  
  
  
  
  
  
  
  
  
  
  
