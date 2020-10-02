# PostgreSQL

### When using a complex command, test how long it takes by prepending:

```text
EXPLAIN (ANALYZE, BUFFERS) 
```

### Install \(on Ubuntu\):

[https://www.digitalocean.com/community/tutorials/how-to-install-and-use-postgresql-on-ubuntu-18-04](https://www.digitalocean.com/community/tutorials/how-to-install-and-use-postgresql-on-ubuntu-18-04)

```text
sudo apt install postgresql postgresql-contrib -y;
```

### Config file:

`/etc/postgresql/12/main/postgresql.conf`

### Manage Users:

**Login as root user:**  
`sudo -u postgres psql`

**Login as user \(same user in Linux/postgres\):**  
`sudo -u postgres psql words` \(as postgres admin, or limited user\)

**Fix user permissions:**  
`ALTER ROLE nodejs LOGIN`, `\password nodejs`,

**Exit:**  
`\q`

**Create postgres user:**  
`sudo -u postgres createuser --interactive`  
Also must create same name/password for Linux:  
`sudo adduser username`

**Edit port number:**  
`ne /etc/postgresql/10/main/postgresql.conf`  
Then, restart for new port to update throughout system:  
`service postgresql`

**Shortcut, to do some of the things without entering SQL:**  
`sudo -u postgres createdb data`

**Create database:**  
`CREATE DATABASE words OWNER nodejs`  
_\*\*_List databases:  
`\l` or `SELECT datname FROM pg_database`

**Create schema:**  
`CREATE SCHEMA data AUTHORIZATION username`  
_\*\*_List databases:  
`\l` or `SELECT datname FROM pg_database`

```text
ALTER DATABASE name OWNER TO new_owner
GRANT CONNECT ON DATABASE "words" TO nodejs
REASSIGN OWNED BY old_name TO new_name;
```

**Login as new user:**  
`sudo -i -u username`  
Change current user password:  
`passwd`

## **Security - read more about it!**

```text
CREATE USER my_ro_user WITH PASSWORD 'XXXXX';
GRANT CONNECT ON DATABASE "postgres" TO my_ro_user;
GRANT USAGE ON SCHEMA public TO my_ro_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO my_ro_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO my_ro_user;
REVOKE CREATE ON SCHEMA public FROM my_ro_user;
```

```text
REVOKE CREATE ON SCHEMA public FROM public;
```

## Upgrade to version 12

[https://computingforgeeks.com/install-postgresql-12-on-ubuntu/](https://computingforgeeks.com/install-postgresql-12-on-ubuntu/)

