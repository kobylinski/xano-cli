import { expect } from 'chai'

import { logger, resolveVerbosity, VERBOSITY } from '../../src/lib/logger.js'

describe('lib/logger', () => {
  describe('resolveVerbosity', () => {
    // Save and restore env vars
    const originalEnv = { ...process.env }

    afterEach(() => {
      process.env = { ...originalEnv }
    })

    it('returns SILENT when --silent flag is set', () => {
      expect(resolveVerbosity(0, true)).to.equal(VERBOSITY.SILENT)
    })

    it('returns VERBOSE when --verbose=1 flag is set', () => {
      expect(resolveVerbosity(1, false)).to.equal(VERBOSITY.VERBOSE)
    })

    it('returns DEBUG when --verbose=2 flag is set', () => {
      expect(resolveVerbosity(2, false)).to.equal(VERBOSITY.DEBUG)
    })

    it('returns TRACE when --verbose=3 flag is set', () => {
      expect(resolveVerbosity(3, false)).to.equal(VERBOSITY.TRACE)
    })

    it('caps verbosity at 3', () => {
      expect(resolveVerbosity(5, false)).to.equal(VERBOSITY.TRACE)
    })

    it('uses XANO_DEBUG env var', () => {
      process.env.XANO_DEBUG = '1'
      expect(resolveVerbosity(undefined, false)).to.equal(VERBOSITY.DEBUG)
    })

    it('uses XANO_VERBOSE env var', () => {
      process.env.XANO_VERBOSE = '2'
      expect(resolveVerbosity(undefined, false)).to.equal(VERBOSITY.DEBUG)
    })

    it('uses config verbosity as fallback', () => {
      expect(resolveVerbosity(undefined, false, 1)).to.equal(VERBOSITY.VERBOSE)
    })

    it('flag takes precedence over env', () => {
      process.env.XANO_VERBOSE = '2'
      expect(resolveVerbosity(1, false)).to.equal(VERBOSITY.VERBOSE)
    })

    it('silent flag takes precedence over verbose', () => {
      expect(resolveVerbosity(3, true)).to.equal(VERBOSITY.SILENT)
    })

    it('defaults to NORMAL when nothing specified', () => {
      expect(resolveVerbosity(undefined, false)).to.equal(VERBOSITY.NORMAL)
    })
  })

  describe('logger', () => {
    it('can set and get level', () => {
      logger.setLevel(VERBOSITY.DEBUG)
      expect(logger.getLevel()).to.equal(VERBOSITY.DEBUG)

      logger.setLevel(VERBOSITY.NORMAL)
      expect(logger.getLevel()).to.equal(VERBOSITY.NORMAL)
    })

    it('isEnabled returns true for levels at or below current', () => {
      logger.setLevel(VERBOSITY.VERBOSE)

      expect(logger.isEnabled(VERBOSITY.SILENT)).to.be.true
      expect(logger.isEnabled(VERBOSITY.NORMAL)).to.be.true
      expect(logger.isEnabled(VERBOSITY.VERBOSE)).to.be.true
      expect(logger.isEnabled(VERBOSITY.DEBUG)).to.be.false
      expect(logger.isEnabled(VERBOSITY.TRACE)).to.be.false
    })
  })
})
