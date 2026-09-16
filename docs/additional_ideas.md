Two promising ideas worth exploring:
1. interpretability-based verification, using model internals rather than text pattern-matching, made possible because Collu sits inside a single operator's own pipeline with real access to every agent's activations
2. counterfactual causal replay (rerunning a workflow with one message or agent removed, to prove an unsafe outcome causally depended on that specific path)
