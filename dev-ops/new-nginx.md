**First, kill any running node processes!**
```text
ps cax | grep node;
kill 1234
```

**Modify config:**
```text
vim /etc/nginx/sites-available/default
```
**Then, restart nginx:**
```
echo "service nginx restart";
```

