---
description: >-
  GitBook is a brilliant GUI for writing documentation in Github markdown
  format. It automatically generates a beautiful website from your markdown
  files, and publishes to your domain.
---

# Embed GitBook on your own website

Like most other [technical documentation website builders](../documentation/tech-docs.md), to share your documentation with the world, you have to direct people to the website GitBook generated for you. You can host it on your own domain and upload your logo, and it looks really nice. But, to remove their branding it's a minimum of $300/mo, and even then you can not add CSS or Javascript.

I figured out a work-around. Here is a step by step tutorial, how I used GitBook-generated HTML pages, including links, CSS, and JavaScript, but I hosted it on my own server. I was able to manipulate the site, remove their branding, and inject my own HTML/CSS/JavaScript:

#### Step 1 - download their website

This script downloads their entire website to your local filesystem. You can then serve the downloaded content using your own server, and embed it in an iframe.

`wget --mirror -p --html-extension --convert-links -r https://paulshorey.gitbook.io/nlp-studio/ docs.nlp.studio`

You can automate this by using a Github "webhook". Whenever you or a team mate saves changes on GitBook, they will push to your Github repository. Github will then send a request to your web server. Your web server will then run the above script, to download the newly built version of your documentation website. 

#### Step 2 - host your own website

Once you've downloaded the website to a folder, simply serve them using your favorite web server. Nginx, NodeJS, http-server, python, PHP, Java, etc. 

But the fun is just beginning. Now that you control the website, you can edit it, add stuff, remove stuff. For example, remove their branding, add your branding. Inject CSS/JavaScript just before the closing `</head>` tag. This too can be automated!

#### Step 3 - add your own CSS, JavaScript, and edit HTML

Whether to completely transform the look and feel, or just add/remove branding, you can accomplish it by injecting a single stylesheet. The "c" in "css" stands for "cascading". This is powerful. You're able to edit any CSS in a website by simply adding a clean new stylesheet at the very end, just before the closing `</head>` tag. In that file, add rules to edit or remove elements, and change styles.

To do this, you'll need to write a script that opens and edits every HTML file in the downloaded folder. I like to use NodeJS, because it can be instantly spawned by a Bash command. Python works well also. 1. Get a list of all html files 2. open each one, and run a "search / replace" command on the full text of the file

To inject CSS, replace `</head>` with `<link rel="stylesheet" src="./my/local/path.css" /></head>`

To inject JavaScript, again replace `</head>` with `<script src="./my/local/path.js"></script></head>` 

To edit content of a webpage, I do the same thing - search/replace. Instead of searching for "&lt;/head&gt;" though, which appears on every page, I search for a specific phrase which I have typed into the website, using the GUI/editor at app.gitbook.com \(this is before I saved the changes and downloaded the built website\). For example, I search for `contact form goes here`, on every page, even though it will only appear on one of the pages. I then replace it with the HTML and JavaScript which renders the contact form. Easy.

