"""SDK compatibility smoke adapters. Not yet qualified for scored swarm runs."""
import os

def deepagents(prompt, sandbox):
    from deepagents import create_deep_agent
    from langchain_openai import ChatOpenAI
    from langchain_core.tools import tool
    @tool
    def execute(command: str) -> str:
        """Execute a shell command in the isolated repository workspace."""
        return str(sandbox.execute(command))
    model = ChatOpenAI(model=os.environ['PILOT_MODEL'],
                       base_url=os.environ.get('PILOT_BASE_URL'))
    agent = create_deep_agent(model=model, tools=[execute])
    return agent.invoke({'messages': [{'role': 'user', 'content': prompt}]},
                        config={'recursion_limit': 40})

def openhands(prompt, sandbox):
    from pydantic import SecretStr
    from openhands.sdk import (LLM, Agent, Conversation, Action, Observation,
                               TextContent, ToolDefinition)
    from openhands.sdk.tool import Tool, ToolExecutor, register_tool
    class ExecuteAction(Action):
        command: str
    class ExecuteObservation(Observation):
        output: str
        @property
        def to_llm_content(self):
            return [TextContent(text=self.output)]
    class Execute(ToolExecutor):
        def __call__(self, action, conversation=None):
            return ExecuteObservation(output=str(sandbox.execute(action.command)))
    class ExecuteTool(ToolDefinition):
        @classmethod
        def create(cls, conv_state, **kwargs):
            return [cls(description='Execute a command in the isolated repository.',
                        action_type=ExecuteAction, observation_type=ExecuteObservation,
                        executor=Execute())]
    register_tool('PilotExecute', ExecuteTool)
    llm = LLM(model='openai/' + os.environ['PILOT_MODEL'],
              api_key=SecretStr(os.environ['OPENAI_API_KEY']),
              base_url=os.environ.get('PILOT_BASE_URL'))
    conversation = Conversation(agent=Agent(llm=llm, tools=[Tool(name='PilotExecute')]),
                                max_iteration_per_run=40, visualizer=None)
    conversation.send_message(prompt)
    conversation.run()
    return conversation
