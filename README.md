# Welcome to my laboratory!

**Why keep notes like this? Read about the** [**Zettelkasten Method**](https://zettelkasten.de/introduction/)\*\*\*\*

**Also good notes/tutorials:**  
\* [https://ciphertrick.com/category/database/](https://ciphertrick.com/category/database/) - few, but some unique and interesting  
\* [https://javascript.info/](https://javascript.info/) - great beginner to advanced guides!  
\* [https://www.javascripttutorial.net/](https://www.javascripttutorial.net/) - lots of great stuff, especially ES.Next  
IDEA: after compiling a definitive list of great programming resource sites, make a Google search URL, to search all those sites on one page!  
\* [https://developers.google.com/web/fundamentals](https://developers.google.com/web/fundamentals) - Tips from Google on making a great site  
  
**A searchable collection of ideas, notes, and code snippets.** Not complete, but growing daily! Some topics have great content. Some just a link or two. I'm just now starting to organize this pile of stuff. For now, there is a search feature \(magnifying glass at the top\)!

Instead of searching through Google or StackOverflow every time, wouldn't it be nice to search just one knowledge base? Programming stuff is easy to forget. So, whenever I look something up, discover a new gotcha, or have a new idea, I document it here in my [GitBook](https://gitbook.com). 

Markdown is great, but it's not the easiest to write, read, and navigate. It takes a lot of getting used to. This GitBook uses Markdown, and can even sync to **.md** files on your private Git repository. It has the most streamlined and intuitive interface, and is good for everything from personal note taking to a large enterprise knowledge base. 

Confluence is tedious to use - so what ends up happening is the team forced to use it does not actually use it often or well, and you end up with incomplete or inaccurate documentation. [GitBook](https://gitbook.com) is easy and fun to use, so you will actually end up with a complete documentation or knowledge base.

This GitBook platform is really excellent for teams. It syncs with your GIT repository. Every time someone makes a change on GitBook.com, it actually commits and pushes to GIT. If two people edit the same line, the app will bring up a prompt to review \(diff\) and resolve the conflict. :D

If you like this guide, agree with most of the sentiments expressed, and would like to use it as your own - add to it, feel free to edit it, and express your own ideas - [then please contact me!](http://paulshorey.com#contact) I'll add you to this organization as an equal collaborator. ~~ [PaulShorey.com](http://paulshorey.com)

## To document your functions/methods, use [Documentation.JS](https://www.npmjs.com/package/documentation)

```javascript
    /**  
     * This function adds one to its input.  
     * @param {number} input any number  
     * @returns {number} that number, plus one.  
     */  
    function addOne(input) {  
      return input + 1;  
    }
```

Generating markdown/html is easy: `documentation readme functions -f md --shallow --section=Functions` it turns the "./functions" directory into a \#h1 section in your README.md file

Development:  
`documentation serve functions -f md --shallow --watch` It will render a documentation site, and host it on localhost:4001, and update when you make changes. Brilliant!

It's industry standard, and there is no other competing standard. JavaScript libraries use it. Even EcmaScript uses it to document its own methods \(.splice, .length, JSON.stringify, etc\). So if you learn how to use it in your IDE, you can quickly right-click \(or similar shortcut\) to see documentation of a JavaScript prototype, instead of having to open your web browser and find the answer on some website.

My IDE \(IntelliJ WebStorm\) adds syntax coloring to the comment block, and even lints my code against the rules set in the comment block \(warns me when something is not documented, or I'm not following my own documentation, for inputs/outputs\). It also lets me right click a function call from any file, to see its documentation. Very useful. [Read more about IDEs...](general-programming/ide-1/)

## Consider using GitBook, to document more abstract concepts

**Written in** [**Markdown**](https://dillinger.io/)**, stored on my** [**Github**](https://github.com/paulshorey/notes)**, hosted by** [**GitBook**](https://www.gitbook.com/)**, publicly viewable at** [**notes.paulshorey.com**](https://notes.paulshorey.com)**. So easy to edit and collaborate. So easy to publish.**

GitBook does not require you to connect your GitHub repository. It can host your content. **But, you may connect it to your Github "wiki" or "api" or "docs" folder**, and edit your docs from your own IDE/codebase.

Collaborators can edit while they view each document. It uses GIT to manage conflicts, and even gives you a diff view, to decide which version of the conflicted code to keep. Usually you won't have conflicts, but it's nice to know that if you and a team mate edit the same paragraph or code block, you can resolve that issue! 

`Cmd + Shift + S` to save changes and merge. Then keep on editing!  So easy to browse, view, search. Make it public or private \(password-protected, for your team only\). I am not affiliated with GitBook, but just love it so much! 

Confluence is so tedious and cumbersome! Yet, most major companies use it, just because it's been around a long time, and uses the same login as Jira \(another terrible program by Atlassian\). They also make BitBucket. BitBucket is great, but so is GitLab. Please get away from Confluence or Jira. Having only one login/authentication to manage is not worth the extra effort and loss of productivity for your engineers. Your IT/security person has to set it up once. But your multiple engineers have to use it every day. So, who's convenience is more important? Engineers are meek people. They will usually not complain. But your organization will secretly be losing a lot of time and productivity if you continue using Atlassian.

## More:

**Sync GitBook with your GitHub.** Edit from either one, and the content will sync.

**Publish your GitBook to a custom domain.** Or subdomain. Then, easily share your documentation with clients, or inside your own team if your space is private.

**Note: GitHub.com markdown flavor is dumb.** It ignores linebreaks, except for lines which have _**two spaces**_ on the end. So, you must end each markdown line with _**two**_ spaces, or GitHub will ignore your linebreak. That's weird. GitBook unfortunately uses the same rule as GitHub, to keep it consistent. So your notes will look the same on GitBook.com/@yoursite as on GitHub.com/yoursite. 

**This is not a GitBook issue, but GitHub's.** I'm a human, and don't want to keep track of which lines have one or two spaces. This is a robot's job. So, I fixed this by making this custom bash function, and running it as a pre-commit hook \(whenever I commit my code, it will run\). Your system must support Perl for this to work, because regular expressions in bash are not as sophisticated. 

```text
# FIX MARKDOWN for GitHub flavor  
 function ghmd() {  
     perl -pi -e 's/[\s]*?\n/\ \ \n/g' *.md;  
     perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*.md;  
     perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*/*.md;  
     perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*/*/*.md;  
     perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*/*/*/*.md;  
     perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*/*/*/*/*.md;  
 }
```

I've been using this for years now, even on clients' codebases, with no detrimental effects, except for an extra few milliseconds lag whenever I commit to GIT.

**See my other** [**CLI shortcuts**](http://paulshorey.com/files/.aliases.sh)**.** I have a function to `git add`, `git commit`, and `git push`. But it does some fancy things to make sure I have the latest code and no merge conflicts. Before executing the `commit`, it executes `ghmd` command, to make any and all `.md` files compatible with GitHub.com's custom markdown rule \(add two spaces at the end of every line\).

**See my previous and current projects at** [**PaulShorey.com**](http://PaulShorey.com)\*\*\*\*

