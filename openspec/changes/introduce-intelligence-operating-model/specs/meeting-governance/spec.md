# meeting-governance

The system SHALL treat meeting as a governance layer over `DecisionObject` candidates, not as a direct consumer of raw source material.

It SHALL define two meeting modes:

- `Review Meeting`
- `Retrospective Meeting`

#### Scenario: Review meeting consumes modeled objects

- **GIVEN** one or more `DecisionObject` candidates with supporting findings and metrics context
- **WHEN** a review meeting is triggered
- **THEN** the meeting consumes those candidates as its primary inputs
- **AND** it does not require raw evidence to be the main meeting input

The system SHALL treat `Meeting Goal` as a decision-policy input that influences weighting, emphasis, and resolution style.

#### Scenario: Meeting goal changes resolution emphasis

- **GIVEN** two meetings with different goals
- **WHEN** they evaluate the same decision candidate
- **THEN** the resulting priority framing or required evidence may differ
- **AND** the difference is attributable to the chosen meeting goal
