# intelligence-object-model

The system SHALL use the following core ontology as the intelligence pipeline:

- `Evidence`
- `Finding`
- `DecisionObject`
- `ActionAsset`

The system SHALL treat `Finding` as the unified judgment object rather than maintaining separate primary `claim`, `pattern`, and `hypothesis` object families.

#### Scenario: Modeling a new intelligence case

- **GIVEN** a scout returns evidence from any source
- **WHEN** the modeling layer processes it
- **THEN** it creates or updates `Finding` objects from evidence
- **AND** may promote them into `DecisionObject` candidates
- **AND** any downstream publishable artifact SHALL be represented as an `ActionAsset`

The system SHALL require lineage:

- every `Finding` links to one or more `Evidence`
- every `DecisionObject` links to one or more `Finding`
- every `ActionAsset` links to one or more `DecisionObject`

#### Scenario: Preventing orphan decisions

- **GIVEN** a decision candidate has no linked findings
- **WHEN** the system attempts to persist it
- **THEN** it rejects or downgrades the object rather than allowing an orphan decision object
