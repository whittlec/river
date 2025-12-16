import './App.css'
import Levels from './components/Levels'

function App() {
  return (
    <div id="app-root">
      <header className="appHeader">
        <h1 className="appTitle">River Levels</h1>
        <div>
          <small>Realtime river levels and short-term forecasts</small>
        </div>
      </header>
      <main className="mainContent">
        <Levels />
      </main>
    </div>
  )
}

export default App
