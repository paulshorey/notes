### Welcome to my Javascript fansite  
**A searchable collection of ideas, notes, and code snippets.**  
If I (or a team mate) has not dealt with an issue in a while and forgot how to do it, quickly look it up here (instead of spending time Googling).  
  
### To document a "code base", the best solution is probably still [Documentation.JS](https://github.com/documentationjs/documentation/blob/master/docs/GETTING_STARTED.md)  
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
  
### About this notes/documentation setup  
  
**Written in [Markdown](https://dillinger.io/), stored on my [Github](https://github.com/paulshorey/notes), hosted by [Gitbook](https://www.gitbook.com/), publically viewable at [notes.paulshorey.com](https://notes.paulshorey.com).**  
  
I've been messing around with different documentation technologies for a while now. All frustrating. Confluence, the leader, is awkward and painful to use and to navigate! Others have their own advantages/disadvantages. So far, GitBook, integrated with GitHub, is by far the best.  
  
GitBook does not require you to connect your GitHub repository. It is a standalone service. Free for one user/space. Starting at $35/month for a company. But, its online web interface is not up to my standards (I'm very annoyed by most web apps). I recently discovered its ability to publish a GitHub repository of Markdown files, as a website, on your domain!  
  
A sigh of relief. So easy to use. Edit your documentation the same way you edit any code. Save it to GitHub the same way you save any other code. After you push to github, GitBook instantly converts your Markdown folder/files/navigation content to a website, and it is instantly available at their url, or your custom domain.  
  
### [GitBook.com](http://gitbook.com)  
Login, create and edit a "space", add some notes or pages, then click on the "cube" icon (integrations) on the left side and connect your github. Then click their "sliders" icon (advanced) to connect your domain. Then, you will never have to login or use their app "http://gitbook.com" ever again. Just use your own git repository, and it will show up at your own domain.  
  
#### One issue, not GitBook's fault, but GitHub's special markdown format  
Github markdown flavor is dumb. It ignores linebreaks, except for lines which have **two spaces** on the end.  
  
I fixed this by using this custom bash function to commit my code. Others available [here, in my CLI Shortcuts file](https://github.com/paulshorey/notes/raw/master/files/linked/CLIShortcuts.sh).  
  
```  
  
# FIX MARKDOWN for GitHub flavor  
 function ghmd() {  
 	perl -pi -e 's/[\s]*?\n/\ \ \n/g' *.md;  
 	perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*.md;  
 	perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*/*.md;  
 	perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*/*/*.md;  
 	perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*/*/*/*.md;  
 	perl -pi -e 's/[\s]*?\n/\ \ \n/g' */*/*/*/*/*.md;  
 }  
  
# SAVE  
function ys() {  
	# First, go through and fix markdown files to be GitHub compatible  
	ghmd;  
  
    # Then, pull, commit, push to current branch, with given argument as commit message  
	branch=$(git symbolic-ref --short HEAD);  
    if [ $branch = dev ] || [ $branch = staging ] || [ $branch = master ]  
	then  
	    echo You should not save directly to $branch;  
	elif [ $1 = dev ] || [ $1 = staging ] || [ $1 = master ]  
	then  
		echo You should not merge to $1;  
	else  
		echo COMMITTING $1;  
		echo "\n\n";  
		# pull  
		git pull;  
		# git stash;  
		# git pull;  
		# git stash pop;  
		# save  
		git add .;  
		git commit -m $1;  
		# push  
		echo "\n\n";  
		echo PUSHING TO $branch;  
		git push;  
		# log  
		echo "\n\n";  
		echo "STATUS:";  
		git status;  
	fi;  
}  
```