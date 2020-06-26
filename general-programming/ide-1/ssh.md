# Editing over SSH

## With VS Code \(best way\):

[https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.vscode-remote-extensionpack](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.vscode-remote-extensionpack)

## With Sublime Text:

**On server,**

_Install rsub:_

```text
wget -O /usr/local/bin/rsub \https://raw.github.com/aurora/rmate/master/rmate  
chmod a+x /usr/local/bin/rsub
```

**On local,**

_Install rsub Sublime3 package:_

**`Cmd-Shift-P`** **`install`** **`rsub`** **`enter`**

_Add proxy:_

**`echo "RemoteForward 52698 localhost:52698" >> ~/.ssh/config`**

_Connect to remote server:_

**`# ssh user@host`**

**On server, when connected, send file to local:**

**`rsub ~/.profile`**

