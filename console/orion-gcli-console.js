/*******************************************************************************
 * @license
 * Copyright (c) 2011 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *     Kris De Volder (VMWare) - initial API and implementation
 *
 *******************************************************************************/ 
/*global define dojo dijit orion window widgets localStorage*/
/*jslint browser:true devel:true*/

define(['dojo', 'orion/git/gitClient', 'orion/bootstrap', 'orion/status', 'orion/commands', 'orion/globalCommands', 'orion/searchClient', 'orion/fileClient', 'gcli/index'], 
function(dojo,  mGitClient,            mBootstrap,        mStatus,        mCommands,        mGlobalCommands,        mSearchClient,        mFileClient,        gcli,         gclitest) {

	var fileClient;
	var statusService;
	
	//The current path. I.e. the working dir relative to which we will execute commands on the server.
	var currentTreeNode = null;
	
	/**
	 * Counter used to generate unique ids that can be used to asynchronously fill in the result
	 * of a command into the dom.
	 */
	var resultId = 0;
	
//	function gitStatusExec() {
//		var resultAsText = JSON.stringify(result);
//		dojo.place('<p>'+resultAsText+'</p>', divId, "only");
//
//		//TODO: How do we get this URL? Probably something to do with dojo.hash. So we essentially keep the value
//		//of pwd in the url.
//		var url = "/gitapi/status/file/I/"; 
//		
//		var divId = 'result'+(resultId++);
//
//		function show(result, cls) {
//			if (typeof(result)!=='string') {
//				//TODO: Need something better here to render the result.
//				result = JSON.stringify(result);
//			}
//			dojo.place('<p class='+cls+'>'+resultAsText+'</p>', divId, "only");
//		}
//		
//		function onLoad(result, request) {
//			show(result, 'ok');
////			var node = dojo.byId(divId);
//			console.log("I'm here");
//			var resultAsText = JSON.stringify(result);
////			var resultNode = dojo.create("pre");
////			resultNode.innerHtml = escape(resultAsText);
//			
//			dojo.place('<p>'+resultAsText+'</p>', divId, "only");
//		};
//		function onError(error) {
//			console.log("I'm here");
//		};
//		
//		gitService.getGitStatus(url, onLoad, onError);
//		return '<div id='+divId+'>Waiting for response...</div>';
//	}


	////////////////////// Utility functions /////////////////////////////////////////////////

	/**
	 * Returns true if string is a string that ends with the string suffix.
	 */
	function endsWith(string, suffix) {
		if (typeof(string)==='string' && typeof(suffix)==='string') {
			var loc = string.lastIndexOf(suffix);
			return (loc + suffix.length) === string.length;
		}
		return false;
	}

	/**
	 * Creates a suitable place folder that can be returned as the result of gcli command
	 * if that command is only producing its result asynchronously.
	 * <p>
	 * Usage: example:
	 *   var premature = makeResultsNodeTxt();
	 *   somethingWithCallBack(function (...) {
	 *      premature.put(...actual result...);
	 *   }
	 *   return premature.txt;
	 */
	function makeResultNodeTxt() {
		var divId = 'result'+resultId++;
		return  { 
			txt: '<div id='+divId+'>Waiting for result...</div>',
			put: function (delayedResult) {
				dojo.place('<p>'+delayedResult+'</p>', divId, 'only');
			}
		};
	}
	
	/**
	 * Make sure that there is a currentTreeNode and call given callback on the tree node
	 * as soon as its available.
	 */
	function withCurrentTreeNode(doit) {
		if (currentTreeNode===null) {
			var location = dojo.hash() || "";
			fileClient.loadWorkspace(location).then(function (node) {
				currentTreeNode = node;
				doit(node);
			});
		} else {
			//Wrapped in a setTimeout to ensure it always executed as later scheduled event.
			//otherwise the execution order will be different depending on whether currentTreeNode==null
			setTimeout(function () {
				doit(currentTreeNode);
			});
		}
	}

	function setCurrentTreeNode(node) {
		currentTreeNode = node;
		if (currentTreeNode.Location) {
			dojo.hash(currentTreeNode.Location);
		}
	}
	
	/**
	 * Calls the callback function 'k' with the children of a given node.
	 * If the children are available the callback function is called immediatrly otherwise 
	 * the children will be retrieved and the callback function called whenever the children
	 * become available.
	 */
	function withChildren(node, k) {
		if (node.Children) {
			k(node.Children);
		} else if (node.ChildrenLocation) {
			fileClient.fetchChildren(node.ChildrenLocation).then(k);
		}
	}

	////////////////// implementation of the ls command ////////////////////////////////////////////////////////////

	/**
	 * Helper function to format a single child node in a directory.
	 */
	function formatLsChild(node, result) {
		result = result || [];
		if (node.Name) {
			result.push(node.Name);
			if (node.Directory) {
				result.push('/');
			}
			result.push('<br>');
		}
		return result;
	}
	
	/**
	 * Helper function to format the result of ls. Accepts a current fileClient node and
	 * formats its children.
	 * <p>
	 * Optionally accepts an array 'result' to which the resulting Strings should be pushed.
	 * <p>
	 * To avoid massive String copying the result is returned as an array of
	 * Strings rather than one massive String. Client should call join('') on the returned result.
	 */
	function formatLs(node, result, k) {
		result = result || [];
		withChildren(node, function (children) {
			for (var i = 0; i < children.length; i++) {
				formatLsChild(children[i], result);
			}
			k(result);
		});
	}

	/**
	 * Execution function for the ls gcli command
	 */
	function lsExec() {
		var result = makeResultNodeTxt();
		withCurrentTreeNode(function (node) {
			formatLs(node, [], function (buffer) {
				result.put(buffer.join(''));
			});
		});
		return result.txt;
	}
	
	////////// implementaton of the 'cd' command ///////////////////////////////////////////////////
	
	function cdExec(args) {
		var targetDirName = args.directory;
		var result = makeResultNodeTxt();
		var newLocation = null;
		withCurrentTreeNode(function (node) {
			if (targetDirName==='..') {
				var location = dojo.hash();
				if (endsWith(location,'/')) {
					location = location.slice(0, location.length-1);
				}
				if (location) {
					var lastSlash = location.lastIndexOf('/');
					if (lastSlash>=0) {
						newLocation = location.slice(0, lastSlash);
					}
				}
				if (newLocation) {
					dojo.hash(newLocation);
					currentTreeNode = null;
					result.put('Changed to parent directory');
				} else {
					result.put('ERROR: Can not determine parent');
				}
			} else {
				withChildren(node, function (children) {
					var found = false;
					for (var i = 0; i < children.length; i++) {
						var child = children[i];
						if (child.Name===targetDirName) {
							if (child.Directory) {
								found = true;
								setCurrentTreeNode(child);
								result.put('Working directory changed successfully');
							} else {
								result.put('ERROR: '+targetDirName+' is not a directory');
							}
						}
					}
					if (!found) {
						result.put('ERROR: '+targetDirName+' not found.');
					}
				});
			}
		});
		return result.txt;
	}
	
	//////// implementation of the 'pwd' command ///////////////////////////////////////////
	
	function pwdExec() {
		//TODO: this implementation doesn't print the full path, only the name of the current
		//  directory node.
		var result = makeResultNodeTxt();
		withCurrentTreeNode(function (node) {
			var buffer = formatLsChild(node);
			result.put(buffer.join(''));
		});
		return result.txt;
	}
	
	/////// implementation of 'vmc get|set-target' commands ////////////////////////////////
	
	function execVmcGetTarget(args, context) {
		var resultNode = makeResultNodeTxt();
		withCurrentTreeNode(function (node) {
			if (node.Location) {
				var location = node.Location;
				dojo.xhrGet({
					url: '/shellapi/vmc/get-target' , 
					headers: {
						"Orion-Version": "1"
					},
					content: { 
						"location":  location,
						"arguments": JSON.stringify(args) 
					},
					handleAs: "text",
			//		timeout: 15000,
					load: function (data) {
						resultNode.put(data);
					},
					error: function(error, ioArgs) {
						resultNode.put(error.message || 'ERROR');
					}
				});
			} else {
				resultNode.put('ERROR: could not determine working directory location');
			}
		});
		return resultNode.txt;
	}
	
	
	function execVmcLogin(args, context) {
		var resultNode = context.createPromise();
		withCurrentTreeNode(function (node) {
			if (node.Location) {
				var location = node.Location;
				dojo.xhrGet({
					url: '/shellapi/vmc/login' , 
					headers: {
						"Orion-Version": "1"
					},
					content: { 
						"location":  location,
						"arguments": JSON.stringify(args) 
					},
					handleAs: "text",
			//		timeout: 15000,
					load: function (data) {
						resultNode.resolve(data);
					},
					error: function(error, ioArgs) {
						resultNode.resolve(error.message || 'ERROR');
					}
				});
			} else {
				resultNode.resolve('ERROR: could not determine working directory location');
			}
		});
		return resultNode;
	}

	function execVmcApps(args, context) {
		var resultNode = context.createPromise();
		withCurrentTreeNode(function (node) {
			if (node.Location) {
				var location = node.Location;
				dojo.xhrGet({
					url: '/shellapi/vmc/apps' , 
					headers: {
						"Orion-Version": "1"
					},
					content: { 
						"location":  location,
						"arguments": JSON.stringify(args) 
					},
					handleAs: "text",
			//		timeout: 15000,
					load: function (data) {
						resultNode.resolve(data);
					},
					error: function(error, ioArgs) {
						resultNode.resolve(error.message || 'ERROR');
					}
				});
			} else {
				resultNode.resolve('ERROR: could not determine working directory location');
			}
		});
		return resultNode;
	}
		
	function execVmcSetTarget(args, context) {
		var resultNode = context.createPromise();
//		setTimeout(function () {
//			resultNode.resolve('Gotcha');
//		});
		withCurrentTreeNode(function (node) {
			if (node.Location) {
				var location = node.Location;
				dojo.xhrGet({
					url: '/shellapi/vmc/set-target' , 
					headers: {
						"Orion-Version": "1"
					},
					content: { 
						"location":  location,
						"arguments": JSON.stringify(args) 
					},
					handleAs: "text",
			//		timeout: 15000,
					load: function (data) {
						resultNode.resolve(data);
					},
					error: function(error, ioArgs) {
						resultNode.resolve(error.message || 'ERROR');
					}
				});
			} else {
				resultNode.resolve('ERROR: could not determine working directory location');
			}
		});
		return resultNode;
	}
	
	function execVmcPush(args, context) {
		var resultNode = context.createPromise();
		withCurrentTreeNode(function (node) {
			if (node.Location) {
				var location = node.Location;
				dojo.xhrGet({
					url: '/shellapi/vmc/push' , 
					headers: {
						"Orion-Version": "1"
					},
					content: { 
						"location":  location,
						"arguments": JSON.stringify(args) 
					},
					handleAs: "text",
			//		timeout: 15000,
					load: function (data) {
						resultNode.resolve(data);
					},
					error: function(error, ioArgs) {
						resultNode.resolve(error.message || 'ERROR');
					}
				});
			} else {
				resultNode.resolve('ERROR: could not determine working directory location');
			}
		});
		return resultNode;
	}
	
	
	/////// implementation of 'npm install' command ////////////////////////////////////////
	
	//TODO: node.js commands should not be in this module, they should be in a plugin or something.
	//  this will require making it possible for plugins to contribute commands to gcli UI.
	
	function execNpmInstall(args, context) {
		var resultNode = makeResultNodeTxt();
		withCurrentTreeNode(function (node) {
			if (node.Location) {
				var location = node.Location;
				dojo.xhrGet({
					url: '/shellapi/npm/install' , 
					headers: {
						"Orion-Version": "1"
					},
					content: { 
						"location":  location,
						"arguments": JSON.stringify(args) 
					},
					handleAs: "text",
	//				timeout: 15000,
					load: dojo.hitch(resultNode, resultNode.put),
					error: function(error, ioArgs) {
						resultNode.put(error.message || 'ERROR');
					}
				});
			} else {
				resultNode.put('ERROR: could not determine working directory location');
			}
		});
		return resultNode.txt;
	}
	
	function initNpmCommands() {
		gcli.addCommand({
			name: 'npm',
			description: 'Node package manager'
		});
		
		gcli.addCommand({
			name: 'npm install',
			description: 'install a package',
			manual: 'This command installs a package, and any packages that it depends on. It resolves circular dependencies by talking to the npm registry',
			exec: execNpmInstall,
			params: [
			    {
					name: 'packages',
					type: { name: 'array', subtype:'string'},
					description: 'package',
					manual: 
						'A package to install. Can be given in one of the following formats: \n'+
						'<tarball file>\n' +
						'<tarball url>\n' +
						'<name>@<tag>\n' +
						'<name>@<version>\n' +
						'<name>@<version_range>'
			    },
			    {
					group: 'Options',
					params: [
						{
							name: 'force', 
							type: 'boolean',
							description: 'force',
							manual: 'Force npm to fecth remote resources even ' +
								'if a local copy exists on disk'
		//					defaultValue: false
						}
					]
			    }
			]
		});
		
		gcli.addCommand({
			name: 'ls',
			description: 'Show a list of files at the current directory',
			exec: lsExec,
			returnType: 'string'
		});
		gcli.addCommand({
			name: 'cd',
			description: 'Change current directory',
			exec: cdExec,
			returnType: 'string',
			params: [
					    {
							name: 'directory',
							type: 'string',
							description: 'directory'
					    }
			]
		});

		gcli.addCommand({
			name: 'pwd',
			description: 'Print current directory',
			exec: pwdExec,
			returnType: 'string'
		});
		
//		
//		gcli.addCommand({
//			name: 'git',
//			description: 
//				'Git is a fast, scalable, distributed revision control system with an unusually rich command set ' +
//				'that provides both high-level operations and full access to internals.'
//		});
//		gcli.addCommand({
//			name: 'git status',
//			description: 'Show the working tree status',
//			manual: 'Displays paths that have differences between the index file and the ' +
//			        'current HEAD commit, paths that have differences between the working ' +
//			        'tree and the index file, and paths in the working tree that are not ' +
//					'tracked by git (and are not ignored by gitignore(5)). The first are ' +
//					'what you would commit by running git commit; the second and third are ' +
//					'what you could commit by running git add before running git commit.',
//			returnType: 'string',
//			exec: gitStatusExec
//		});
	}
	
	function initVmcCommands() {
		gcli.addCommand({
			name: 'vmc',
			description: 'Cloudfoundry Commandline Client',
			manual: 'A nice manual for VMC goes in here'
		});

		gcli.addCommand({
			name: 'vmc apps',
			description: 'Reports apps installed on target',
			manual: 'A nice manual for VMC goes in here',
			params: [],
			exec: execVmcApps
		});
		
		gcli.addCommand({
			name: 'vmc get-target',
			description: 'Reports current target or sets a new target',
			manual: 'A nice manual for VMC goes in here',
			params: [],
			exec: execVmcGetTarget
		});
		
		gcli.addCommand({
			name: 'vmc set-target',
			description: 'Reports current target or sets a new target',
			manual: 'A nice manual for VMC goes in here',
			params: [
					    {
							name: 'target',
							type: 'string',
							description: 'Server target'
					    }
			],
			exec: execVmcSetTarget
		});
		
		gcli.addCommand({
			name: 'vmc login',
			description: 'Login to currenlty selected target',
			manual: 'Login to currenlty selected target',
			params: [
					    {
							name: 'email',
							type: 'string',
							description: "User's email address"
					    },
					    {
							name: 'passwd',
							type: 'string',
							description: 'Password'
						}
			],
			exec: execVmcLogin
		});
		
		gcli.addCommand({
			name: 'vmc push',
			description: 'Deploy app to cloudfoundry',
			manual: 'Deploy app to cloudfoundry',
			params: [
					    {
							name: 'appname',
							type: 'string',
							description: "Appname"
					    },
					    {
							name: 'url',
							type: 'string',
							description: 'Deployment URL',
							defaultValue: null
						},
						{
							name: 'instances',
							type: 'number',
							description: 'number of instances',
							defaultValue: 1
						},
						{
							name: 'mem',
							type: 'number',
							description: 'Memory (Mb)',
							defaultValue: 512
						},
						{	
							name: 'no-start',
							type: 'boolean',
							description: 'Do NOT start the app'
						}
			],
			exec: execVmcPush
		});
		
	}
	
	function initCommands() {
		initNpmCommands();
		initVmcCommands();
	}
	
	dojo.addOnLoad(function() {
		mBootstrap.startup().then(function(core) {
		
			var serviceRegistry = core.serviceRegistry;
			var preferences = core.preferences;
			
//			preferencesCorePreferences = core.preferences;	

			document.body.style.visibility = "visible";
			dojo.parser.parse();

//			preferenceDialogService = new mDialogs.DialogService(serviceRegistry);
		
			// Register services
//			var dialogService = new mDialogs.DialogService(serviceRegistry);
			statusService = new mStatus.StatusReportingService(serviceRegistry, "statusPane", "notifications");
			var commandService = new mCommands.CommandService({serviceRegistry: serviceRegistry});
//			gitService = new mGitClient.GitService(serviceRegistry);
	
//			var siteService = new mSiteService.SiteService(serviceRegistry);
			fileClient = new mFileClient.FileClient(serviceRegistry);
			var searcher = new mSearchClient.Searcher({serviceRegistry: serviceRegistry, commandService: commandService, fileService: mFileClient});
			mGlobalCommands.generateBanner("banner", serviceRegistry, commandService, preferences, searcher);

			statusService.setMessage("Loading...");
			dojo.ready(initCommands);
			gcli.createView();
		});
	});
});