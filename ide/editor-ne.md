---  
description: >-  
  A "nice editor" for command line and GIT commits. By far the most intuitive  
  CLI editor to use, supports some basic features and bindings. Unfortunately,  
  no plugins, no support, and not maintained.  
---  
  
# EDITOR=ne  
  
**Make Default:**  
`echo "export EDITOR=ne" >> ~/.zprofile`  
  
**Documentation:**  
[http://ne.di.unimi.it/ne.pdf](http://ne.di.unimi.it/ne.pdf)  
  
{% tabs %}  
{% tab title="Keyboard Shortcuts \(including custom ~/.ne/.keys configuration below\):" %}  
**^s, ^q**   save, quit  
**^z, ^x, ^c, ^v**   undo, cut  
**^y**   delete current line  
**^u**   paste deleted line  
  
**^d**   delete line  
**^w, ^e**   start of, end of line  
{% endtab %}  
{% endtabs %}  
  
## Custom Key Bindings  
  
1. hit: `^k`  
2. type: `kc`  
3. hit `key` to see its hex code and currently bound command  
4. `echo 'KEY {CODE} {ACTION}' >> ~/.ne/.keys`  
  
KEY {CODE} when pressing `fn`  key is `0x` plus whatever key you're pushing. So, `delete` key code is `115`. But, `fn + delete` key code is `0x115`.  
  
[http://www.emerson.emory.edu/services/editors/ne/Key\_Bindings.html](http://www.emerson.emory.edu/services/editors/ne/Key_Bindings.html)  
Defaults: [https://github.com/vigna/ne/blob/master/doc/default.keys](https://github.com/vigna/ne/blob/master/doc/default.keys)  
  
Sample ~/.ne/.keys file:  
  
```text  
# [delete]  
KEY     0x7f    Backspace  
# [ctrl]+[z]  
KEY     0x1a    Undo  
# [ctrl]+[r]  
KEY     0x12    Redo  
  
# [ctrl]+[d](delete line)  
KEY     0x04    DL  
# [ctrl]+[w]=(start of line)  
KEY     0x17    SOL  
# [ctrl]+[e]=(end of line)  
KEY     0x05    EOL  
  
```  
  
  
  
