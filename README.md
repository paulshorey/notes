---
description: >-
  How to make this collaborative? Set up an organization, $32/mo. Todo when I
  have more devs.
---

# Document everything!

**This is a searchable collection of ideas, notes, and code snippets...**  
Instead of searching on Google or StackOverflow, if I remember that I've deal with an issue in the past \(and recently have been writing them down\), then I just search here and get exactly what I need. Still brainstorming how to make this more collaborative - but then that is what StackOverflow is for. This GitBook platform is really excellent for teams. I have not used GitBook at any employer/team yet. But, I have collaborated on it with my partner and wife - not for programming, but for linguistic stuff - and it worked great! Collaborating on this thing is easy! Not tedious!

## To document the details of a codebase, use [Documentation.JS](https://github.com/documentationjs/documentation/blob/master/docs/GETTING_STARTED.md) !

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

It's industry standard, and there is no other competing standard. JavaScript libraries use it. Even EcmaScript uses it to document its own methods \(.splice, .length, JSON.stringify, etc\). So if you learn how to use it in your IDE, you can quickly right-click \(or similar shortcut\) to see documentation of a JavaScript prototype, instead of having to open your web browser and find the answer on some website.

My IDE \(IntelliJ WebStorm\) adds syntax coloring to the comment block, and even lints my code against the rules set in the comment block \(warns me when something is not documented, or I'm not following my own documentation, for inputs/outputs\). It also lets me right click a function call from any file, to see its documentation. Very useful. [Read more about IDEs...](general-programming/ide-1/)

## Consider using GitBook, to document more abstract concepts.

**Written in** [**Markdown**](https://dillinger.io/)**, stored on my** [**Github**](https://github.com/paulshorey/notes)**, hosted by** [**GitBook**](https://www.gitbook.com/)**, publicly viewable at** [**notes.paulshorey.com**](https://notes.paulshorey.com)**. So easy to edit and collaborate. So easy to publish.**

GitBook does not require you to connect your GitHub repository. It can host your content. **But, you may connect it to your Github "wiki" or "api" or "docs" folder**, and edit your docs from your own IDE/codebase.

Collaborators can edit while they view each document. It uses GIT to manage conflicts, and even gives you a diff view, to decide which version of the conflicted code to keep. Usually you won't have conflicts, but it's nice to know that if you and a team mate edit the same paragraph or code block, you can resolve that issue! 

`Cmd + Shift + S` to save changes and merge. Then keep on editing!  So easy to browse, view, search. Make it public or private \(password-protected, for your team only\). I am not affiliated with GitBook, but just love it so much! 

Confluence is so tedious and cumbersome! Yet, most major companies use it, just because it's been around a long time, and uses the same login as Jira \(another terrible program by Atlassian\). They also make BitBucket - a complete suite of software engineering tools under the same login. BitBucket is great, but so is GitLab. Please get away from Confluence or Jira. Having only one login/authentication to manage is not worth the extra effort and loss of productivity for your engineers. Your IT/security person has to set it up once. But your multiple engineers have to use it every day. So, who's convenience is more important? Engineers are meek people. They will usually not complain. But your organization will secretly be losing a lot of time and productivity if you continue using Confluence and Jira.

## Advanced:

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

