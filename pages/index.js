import Head from 'next/head'
import seedrandom from 'seedrandom'
import { logEvent, getAnalytics } from 'firebase/analytics'
import { Fragment, useEffect, useState, useRef, useMemo } from 'react'

import { Keyboard, Display, Snackbar, Header } from '@components/main'
import metadata from '@util/metadata.json'
import DICTIONARY from '@util/dictionary.json'
import ANSWERS from '@util/answers.json'
import styles from '@styles/main/main.module.sass'

const searchWord = input => {
  const initials = [
    'b', 'p', 'm', 'f',
    'g', 'k', 'ng', 'h',
    'd', 't', 'n', 'l',
    'gw', 'kw', 'w', 'j',
    'z', 'c', 's', '-'
  ]
  if (!initials.includes(input[0]) || !initials.includes(input[3])) 
    return;
  let arr = DICTIONARY[input[0]][input[3]]
  outerloop: for (let i = 0; i < arr.length; i++) {
    let testWord = arr[i]
    for (let j = 1; j < 6; j++) {
      if (testWord[j] !== input[j]) 
        continue outerloop;
    }
    return testWord
  }
}

const evaluate = (input, answer, _guessed) => {
  let evaluation = []
  let guessed = {..._guessed}
  input.forEach((entry, idx) => {
    if (!answer.includes(entry)) {
      evaluation[idx] = 'absent'
      return guessed[entry] = 'absent'
    }
    if (answer[idx] === entry) {
      evaluation[idx] = 'correct'
      return guessed[entry] = 'correct'
    }
    // Present: Excluding corrects and flagged (as present) 
    const occurance = answer.reduce((acc, val, i) => 
      val === entry ? [...acc, i] : acc
    , [])
    const fulfilled = occurance.reduce((acc, val) =>
      input[val] === entry ? acc + 1 : acc
    , 0)
    const flagged = evaluation.reduce((acc, val, i) => 
      val === 'present' && input[i] === entry ? acc + 1 : acc
    , 0)
    if (occurance.length > fulfilled + flagged) {
      evaluation[idx] = 'present'
      return guessed[entry] = 'present'
    }
    evaluation[idx] = 'absent'
  })
  evaluation.forEach(result => logEvent(getAnalytics(), `tile_${result}`))
  return { evaluation, guessed }
}

const getAnswer = (date, asString = false) => {
  const rng = new seedrandom(asString ? date : date.toLocaleDateString('sv'))
  return ANSWERS.result[Math.floor(rng() * ANSWERS.result.length)]
}

export default function Home() {

  // Game States
  const [inputs, setInputs] = useState(Array.from({length: 6}).map(_ => Array.from({length: 6}).map(_ => '')))
  const [evaluations, setEvaluations] = useState(Array.from({length: 6}).map(_ => null))
  const [guessed, setGuessed] = useState({})
  const [hardMode, setHardMode] = useState(false)
  const [curr, setCurr] = useState({row: 0, entry: 0})

  // Flags
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [ending, setEnding] = useState(null)
  const [dialog, setDialog] = useState({
    help: false,
    info: false,
    settings: false,
    statistics: false
  })

  const answer = useMemo(() => getAnswer(new Date()), [])

  const setStatus = (mode, content) => {
    if (mode === 'error') {
      setError(content)
      setTimeout(() => setError(null), 2000)
    }
    if (mode === 'success') {
      setSuccess(content)
      setTimeout(() => setSuccess(null), 2000)
    }
  }

  const handleSelect = input => e => {
    if (ending || curr.entry > 5) return
    logEvent(getAnalytics(), 'keyboard_select')
    setInputs(prevInputs => {
      prevInputs[curr.row][curr.entry] = input
      return prevInputs
    })
    setCurr({
      ...curr,
      entry: curr.entry + 1
    })
  }

  const handleDelete = e => {
    if (ending || curr.entry === 0) return
    logEvent(getAnalytics(), 'keyboard_delete')
    setInputs(prevInputs => {
      prevInputs[curr.row][curr.entry-1] = ''
      return prevInputs
    })
    setCurr({
      ...curr,
      entry: curr.entry - 1
    })
  }

  const handleSubmit = e => {
    if (ending) return
    if (curr.entry !== 6) {
      logEvent(getAnalytics(), 'submit_err_insufficient_words')
      return setStatus('error', '唔夠字數喎')
    }
    if (hardMode && curr.row !== 0) {
      const currInput = inputs[curr.row]
      const prevInput = inputs[curr.row-1]
      const prevEval = evaluations[curr.row-1]
      const currInputWithoutCorrect = currInput.reduce((acc, word, i) => {
        if (prevEval[i] === 'correct') return acc
        return [...acc, word]
      }, [])
      for (let i = 0; i < 6; i++) {
        if (prevEval[i] === 'absent') continue;
        if (prevEval[i] === 'correct' && prevInput[i] !== currInput[i]) { 
          logEvent(getAnalytics(), 'submit_err_correct')
          return setStatus('error', `第 ${i+1} 個字要係 ${prevInput[i].toUpperCase()}`)
        }
        if (prevEval[i] === 'present' && !currInputWithoutCorrect.includes(prevInput[i])) {
          logEvent(getAnalytics(), 'submit_err_present')
          return setStatus('error', `一定要包括 ${prevInput[i].toUpperCase()}`)
        }
      }
    }

    const result = searchWord(inputs[curr.row])
    if (!result) {
      logEvent(getAnalytics(), 'submit_err_not_word')
      return setStatus('error', '揾唔到依個詞')
    }

    logEvent(getAnalytics(), 'submit_success')
    const evaluation = evaluate(inputs[curr.row], answer, guessed)
    setEvaluations(prevEval => {
      prevEval[curr.row] = evaluation.evaluation
      return prevEval
    })
    setGuessed({...guessed, ...evaluation.guessed})
    setStatus('success', result[result.length - 1])
    setCurr({
      entry: 0,
      row: curr.row + 1,
    })
  }

  const handleToggleDialog = panel => e => {
    logEvent(getAnalytics(), `dialog_open_${panel}`)
    setDialog({
      ...dialog,
      [panel]: !dialog[panel]
    })
  }
  const handleToggleHardMode = e => {
    logEvent(getAnalytics(), `hard_mode_${hardMode ? 'off' : 'on'}`)
    setHardMode(!hardMode)
  }

  // Setup on enter
  useEffect(() => {
    const local = JSON.parse(localStorage.getItem('gameState'))
    // Use new word
    if (!local || getAnswer(local.gameDate, true)[6] !== answer[6]) {
      logEvent(getAnalytics(), 'game_start')
      return;
    }
    logEvent(getAnalytics(), 'game_start_reenter')
    // Use old word
    setInputs(local.gameBoard)
    setEvaluations(local.evaluations)
    setHardMode(local.hardMode)
    setGuessed(local.guessed)
    setCurr({row: local.rowIndex, entry: 0})
    if (local.gameStatus === 'WON') setEnding(local.rowIndex)
    else if (local.gameStatus === 'LOST') setEnding('fail')
  }, [])

  useEffect(() => {
    let currDate = new Date()
    localStorage.setItem('gameState', JSON.stringify({
      gameBoard: inputs,
      evaluations,
      hardMode,
      guessed,
      rowIndex: curr.row,
      gameDate: currDate.toLocaleDateString('sv'),
      gameStatus: ending === 'fail' ? 'LOST'
        : ending ? 'WON'
        : 'IN_PROGRESS'
    }))
  }, [curr.row, hardMode, ending])

  // Determine game over
  useEffect(() => {
    if (curr.row === 0 || !evaluations[curr.row-1]) return
    const allCorrect = row => evaluations[row].every(elem => elem === 'correct')
    if (allCorrect(curr.row-1)) {
      setTimeout(() => setEnding(curr.row), 250 * 6)
      return
    }
    if (curr.row === 6)
      setTimeout(() => setEnding('fail'), 250 * 6)
  }, [curr.row, evaluations])

  useEffect(() => {
    if (!ending) return
    // Only modify statistics when the latest row is submitted (and not imported)
    if (success) {
      logEvent(getAnalytics(), `game_end_${ending}`)
      const local = localStorage.getItem('statistics')
      const stats = local ? JSON.parse(local) : {
        gamesPlayed: 0,
        gamesWon: 0,
        winPercentage: 0,
        currentStreak: 0,
        maxStreak: 0,
        guesses: {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, fail: 0}
      }
      stats.gamesPlayed += 1
      stats.gamesWon = ending !== 'fail' ? stats.gamesWon + 1 : stats.gamesWon
      stats.winPercentage = Math.floor(stats.gamesWon / stats.gamesPlayed * 100)
      stats.currentStreak = ending !== 'fail' ? stats.currentStreak + 1 : 0
      stats.maxStreak = stats.currentStreak >= stats.maxStreak ? stats.currentStreak : stats.maxStreak
      stats.guesses[ending] = stats.guesses[ending] + 1
      localStorage.setItem('statistics', JSON.stringify(stats))
    }
    handleToggleDialog('statistics')()
  }, [ending])

  return (
    <Fragment>
      <Head>
        <meta charSet="UTF-8"/>
        <title>{metadata.title}</title>
        {Object.entries(metadata.document).map(([type, content]) => 
          <meta key={type} name={type} content={content}/>)}
        {Object.entries(metadata.og).map(([type, content]) => 
          <meta key={`og:${type}`} property={`og:${type}`} content={content}/>)}
        {Object.entries(metadata.twitter).map(([type, content]) => 
          <meta key={`twitter:${type}`} name={`twitter:${type}`} content={content}/>)}
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className={styles.root}>
        <Header
          dialog={dialog}
          handleToggleDialog={handleToggleDialog}
          guessed={guessed}
          ending={ending}
          answer={answer}
          evaluations={evaluations}
          hardMode={hardMode}
          handleToggleHardMode={handleToggleHardMode}
        />
        <Display 
          inputs={inputs} 
          evaluations={evaluations}
          error={error}
          currRow={curr.row}
        />
        <Keyboard 
          handleSelect={handleSelect}
          handleDelete={handleDelete}
          handleSubmit={handleSubmit}
          guessed={guessed}
        />
        <Snackbar 
          success={success} 
          error={error}
        />
      </div>
    </Fragment>
  )
}