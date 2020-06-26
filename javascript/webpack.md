# webpack

**If running development environment on Linux, watching for file changes, may have to increase number of inotify processes...**

Listen uses inotify by default on Linux to monitor directories for changes. It's not uncommon to encounter a system limit on the number of files you can monitor. For example, Ubuntu Lucid's \(64bit\) inotify limit is set to 8192.

The current default is 8192 \(see fs/notify/inotify/inotify\_user.c in the kernel source\), you can verify this by printing the file to stdout:  


```text
cat /proc/sys/fs/inotify/max_user_watches
8192
```

You can bump the number up, for example, doubling this to 16384, using:  


```text
echo 16384 | sudo tee /proc/sys/fs/inotify/max_user_watches
```

bear in mind that inotify watches do consume memory, I think it's around 160 bytes per watch on 64 bit systems.

To set this permanently, add an entry to /etc/sysctl.conf, for example:  


```text
echo fs.inotify.max_user_watches=16384 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

..or manually edit /etc/sysctl.conf \(you need root privileges to update it\) and then run  


```text
sudo sysctl -p
```

