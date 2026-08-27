type AnswerCorrectness = {
  isCorrect: boolean | null;
};

export function countAnswerCorrectness(answers: readonly AnswerCorrectness[]) {
  return answers.reduce(
    (counts, answer) => {
      if (answer.isCorrect === true) {
        counts.correct += 1;
      } else if (answer.isCorrect === false) {
        counts.incorrect += 1;
      }

      return counts;
    },
    { correct: 0, incorrect: 0 },
  );
}
