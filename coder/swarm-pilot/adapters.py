"""Isolated SDK entrypoint. All repository tools call the trusted controller."""
import json
import os
import urllib.request


def remote(name, **arguments):
    body = dict(owner=os.environ['PILOT_OWNER'],name=name,arguments=arguments)
    request = urllib.request.Request(os.environ['PILOT_GATEWAY_URL']+'/tool',
        data=json.dumps(body).encode(),headers={'Content-Type':'application/json',
        'Authorization':'Bearer '+os.environ['PILOT_GATEWAY_TOKEN']})
    with urllib.request.urlopen(request,timeout=1200) as r: return json.load(r)


def deepagents(prompt):
    from deepagents import (create_deep_agent, HarnessProfile, register_harness_profile,
                             GeneralPurposeSubagentProfile)
    from langchain_openai import ChatOpenAI
    from langchain_core.tools import tool
    register_harness_profile('openai', HarnessProfile(
        general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
        excluded_tools=['task','ls','read_file','write_file','edit_file','glob','grep']))
    @tool("repo_command")
    def execute(command: str) -> str:
        """Execute a shell command in the isolated repository workspace."""
        return json.dumps(remote('execute',command=command))
    @tool
    def delegate(owner: str, paths: list[str], instruction: str) -> str:
        """Delegate bounded work with exclusive paths to a nondelegating worker."""
        return json.dumps(remote('delegate',owner=owner,paths=paths,instruction=instruction))
    tools = [execute] + ([delegate] if os.environ['PILOT_OWNER']=='conductor' else [])
    model = ChatOpenAI(model=os.environ['PILOT_MODEL'],api_key=os.environ['PILOT_GATEWAY_TOKEN'],
        base_url=os.environ['PILOT_GATEWAY_URL']+'/v1',max_tokens=1024,streaming=False,max_retries=0)
    agent = create_deep_agent(model=model, tools=tools, subagents=[],
        system_prompt='Use repo_command for repository reads/checks. Only delegate workers may modify files. '
        'Worker roles use repo_command to edit their claimed files. Report actual evidence only.')
    result=agent.invoke({'messages':[{'role':'user','content':prompt}]},config={'recursion_limit':80})
    print(json.dumps({'final':str(result['messages'][-1].content)}))


def openhands(prompt):
    from pydantic import SecretStr
    from openhands.sdk import (LLM,Agent,Conversation,Action,Observation,TextContent,ToolDefinition)
    from openhands.sdk.tool import Tool,ToolExecutor,register_tool
    class ExecuteAction(Action): command: str
    class DelegateAction(Action):
        owner: str
        paths: list[str]
        instruction: str
    class Result(Observation):
        output: str
        @property
        def to_llm_content(self): return [TextContent(text=self.output)]
    class Execute(ToolExecutor):
        def __call__(self,action,conversation=None):
            return Result(output=json.dumps(remote('execute',command=action.command)))
    class Delegate(ToolExecutor):
        def __call__(self,action,conversation=None):
            return Result(output=json.dumps(remote('delegate',owner=action.owner,
                paths=action.paths,instruction=action.instruction)))
    class repo_command(ToolDefinition):
        @classmethod
        def create(cls,conv_state,**kwargs):
            return [cls(description='Execute a command in the isolated repository. Conductor cannot write.',
                action_type=ExecuteAction,observation_type=Result,executor=Execute())]
    class delegate(ToolDefinition):
        @classmethod
        def create(cls,conv_state,**kwargs):
            return [cls(description='Delegate to a nondelegating worker with exclusive paths.',
                action_type=DelegateAction,observation_type=Result,executor=Delegate())]
    register_tool('PilotExecute',repo_command);register_tool('PilotDelegate',delegate)
    tools=[Tool(name='PilotExecute')]
    if os.environ['PILOT_OWNER']=='conductor':tools.append(Tool(name='PilotDelegate'))
    llm=LLM(model='openai/'+os.environ['PILOT_MODEL'],
        api_key=SecretStr(os.environ['PILOT_GATEWAY_TOKEN']),
        base_url=os.environ['PILOT_GATEWAY_URL']+'/v1',max_output_tokens=1024,
        num_retries=0)
    c=Conversation(agent=Agent(llm=llm,tools=tools),max_iteration_per_run=40,visualizer=None)
    try:
        c.send_message(prompt);c.run()
        print(json.dumps({'final':'OpenHands turn finished; acceptance is independently checked.'}))
    finally:c.close()

if __name__=='__main__':
    import sys
    config=json.load(sys.stdin)
    globals()[config['arm']](config['prompt'])
